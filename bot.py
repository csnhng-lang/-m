"""Bot Discord: mention một người để xem hồ sơ tài khoản chi tiết.

Chạy:  python bot.py     (cần file .env, xem .env.example / README.md)

Kiến trúc:
- ``models``      : kiểu dữ liệu + làm sạch văn bản (không phụ thuộc discord.py)
- ``store``       : kho JSON, ghi atomic
- ``embeds``      : dựng embed (test được độc lập)
- ``github_api``  : tra cứu GitHub công khai (tuỳ chọn)
- ``bot.py``      : nối mọi thứ lại, xử lý lệnh/sự kiện, cooldown, quyền
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time
from collections.abc import Iterable

import discord
from discord import app_commands
from discord.ext import commands

import embeds
import models
from config import Config, ConfigError, from_env, load_dotenv
from github_api import GitHubClient, GitHubError
from models import LinkedAccount, RoleInfo, UserProfile, UserSnapshot, ValidationError
from store import AccountStore, StoreError

LOGGER = logging.getLogger("accountbot")
MAX_TARGETS_PER_MESSAGE = 3
PREFIX_FOLLOW_CHARS = frozenset(" \n<")  # "!info @user", "!info\n@user", "!info <@123>"
GITHUB_LOOKUPS_PER_REPLY = 3


# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #
def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    logging.getLogger("discord.http").setLevel(logging.WARNING)
    logging.getLogger("discord.gateway").setLevel(logging.WARNING)


def _matches_prefix(content: str, prefix: str) -> bool:
    """True nếu tin nhắn bắt đầu bằng tiền tố lệnh (tránh khớp "!information")."""
    if not content.startswith(prefix):
        return False
    rest = content[len(prefix) :]
    return rest == "" or rest[0] in PREFIX_FOLLOW_CHARS or rest.lstrip(" ").startswith("<@") or not rest.strip()


def build_intents(cfg: Config) -> discord.Intents:
    intents = discord.Intents.default()
    intents.guilds = True
    intents.members = True                      # cần cho roles/joined_at
    intents.presences = cfg.presence_intent     # cần cho status/activity
    intents.message_content = cfg.mention_trigger != "off"
    intents.dm_messages = False
    return intents


# --------------------------------------------------------------------------- #
# Bot
# --------------------------------------------------------------------------- #
class AccountBot(commands.Bot):
    def __init__(self, cfg: Config) -> None:
        super().__init__(
            command_prefix=commands.when_mentioned_or(cfg.command_prefix),
            intents=build_intents(cfg),
            help_command=None,
            allowed_mentions=discord.AllowedMentions.none(),
            activity=discord.Activity(type=discord.ActivityType.watching, name="@user để xem hồ sơ"),
        )
        self.cfg = cfg
        self.store = AccountStore(cfg.data_path)
        self.github = (
            GitHubClient(token=cfg.github_token, ttl_seconds=300.0)
            if cfg.github_enrich
            else None
        )
        self._cooldowns: dict[tuple[int, int], float] = {}
        self._store_lock = asyncio.Lock()

    # -- vòng đời ----------------------------------------------------------- #
    async def setup_hook(self) -> None:
        self.store.load()
        LOGGER.info("Đã nạp %d hồ sơ từ %s", len(self.store), self.cfg.data_path)
        self._register_commands()
        self.tree.on_error = self._on_app_command_error
        await self._sync_commands()

    async def close(self) -> None:
        if self.github:
            await self.github.close()
        await super().close()

    async def _sync_commands(self) -> None:
        try:
            if self.cfg.guild_id:
                guild = discord.Object(id=self.cfg.guild_id)
                synced = await self.tree.sync(guild=guild)
                LOGGER.info("Đã đồng bộ %d lệnh vào guild %s", len(synced), self.cfg.guild_id)
            else:
                synced = await self.tree.sync()
                LOGGER.info(
                    "Đã đồng bộ %d lệnh toàn cục (có thể mất tới 1 giờ mới hiện; "
                    "đặt GUILD_ID trong .env để hiện ngay)",
                    len(synced),
                )
        except discord.HTTPException as exc:
            LOGGER.error("Đồng bộ lệnh slash thất bại: %s", exc)

    # -- tiện ích ----------------------------------------------------------- #
    def _is_staff(self, user: discord.abc.User | None, guild: discord.Guild | None) -> bool:
        if user is None:
            return False
        member = guild.get_member(user.id) if guild else user
        perms = getattr(member, "guild_permissions", None)
        if perms is not None and (perms.administrator or perms.manage_guild):
            return True
        if self.cfg.privacy_role_id:
            roles = getattr(member, "roles", [])
            if any(getattr(role, "id", None) == self.cfg.privacy_role_id for role in roles):
                return True
        return False

    def _cooldown_hit(self, guild_id: int, target_id: int) -> bool:
        if self.cfg.cooldown_seconds <= 0:
            return False
        key = (guild_id, target_id)
        now = time.monotonic()
        last = self._cooldowns.get(key)
        if last is not None and now - last < self.cfg.cooldown_seconds:
            return True
        self._cooldowns[key] = now
        if len(self._cooldowns) > 4096:
            cutoff = now - self.cfg.cooldown_seconds
            self._cooldowns = {k: v for k, v in self._cooldowns.items() if v >= cutoff}
        return False

    async def _snapshot(
        self,
        target: discord.abc.User,
        guild: discord.Guild | None,
    ) -> UserSnapshot:
        member: discord.Member | None = None
        if guild is not None:
            member = guild.get_member(target.id)
            if member is None:
                try:
                    member = await guild.fetch_member(target.id)
                except discord.NotFound:
                    member = None
                except discord.HTTPException as exc:
                    LOGGER.warning("Không lấy được member %s: %s", target.id, exc)

        user: discord.abc.User = target
        if member is not None:
            user = member
        else:
            try:
                user = await self.fetch_user(target.id)
            except discord.HTTPException as exc:
                LOGGER.warning("Không lấy được user %s: %s", target.id, exc)

        roles: list[RoleInfo] = []
        if member is not None:
            roles = [
                RoleInfo(
                    name=role.name,
                    position=role.position,
                    color=getattr(role.color, "value", 0),
                    is_default=role.is_default(),
                )
                for role in member.roles
            ]
            roles.sort(key=lambda r: r.position, reverse=True)

        activities: list[str] = []
        status: str | None = None
        if self.cfg.presence_intent and member is not None:
            status = member.status.name
            for activity in member.activities[:3]:
                activity_name = getattr(activity, "name", "") or ""
                if isinstance(activity, discord.CustomActivity):
                    text = activity_name or (getattr(activity, "state", "") or "")
                elif isinstance(activity, discord.Spotify):
                    text = f"🎵 Spotify — {activity.title} ({activity.artist})"
                else:
                    text = activity_name
                text = text.strip()
                if text:
                    activities.append(text)

        flags: list[str] = []
        public_flags = getattr(user, "public_flags", None)
        if public_flags is not None:
            try:
                flags = [flag.name for flag in public_flags.all()]
            except TypeError:
                flags = []

        banner_url: str | None = None
        banner = getattr(user, "banner", None)
        if banner is not None:
            banner_url = banner.url

        accent = getattr(user, "accent_color", None)

        return UserSnapshot(
            user_id=user.id,
            username=user.name,
            display_name=getattr(user, "display_name", user.name),
            is_bot=user.bot,
            nickname=getattr(member, "nick", None) if member else None,
            created_at=user.created_at,
            joined_at=getattr(member, "joined_at", None) if member else None,
            guild_name=guild.name if guild else None,
            roles=roles,
            boost_since=getattr(member, "premium_since", None) if member else None,
            status=status,
            activities=activities,
            avatar_url=(member.guild_avatar or member.display_avatar).url if member else user.display_avatar.url,
            banner_url=banner_url,
            public_flags=flags,
            accent_color=getattr(accent, "value", None) if accent is not None else None,
        )

    async def _github_profiles(
        self, accounts: Iterable[LinkedAccount]
    ) -> tuple[dict, dict[str, str]]:
        if self.github is None:
            return {}, {}
        logins = [
            account.handle
            for account in accounts
            if account.type.lower() == "github" and account.handle
        ][:GITHUB_LOOKUPS_PER_REPLY]
        if not logins:
            return {}, {}

        results = await asyncio.gather(
            *(self.github.fetch(login) for login in logins), return_exceptions=True
        )
        profiles: dict = {}
        errors: dict[str, str] = {}
        for login, result in zip(logins, results, strict=True):
            if isinstance(result, GitHubError):
                errors[login] = str(result)
            elif isinstance(result, Exception):
                LOGGER.warning("Lỗi tra GitHub cho %s: %s", login, result)
                errors[login] = "không tra cứu được"
            elif result is None:
                errors[login] = "không tìm thấy người dùng GitHub này"
            else:
                profiles[login] = result
        return profiles, errors

    async def build_embed(
        self,
        target: discord.abc.User,
        guild: discord.Guild | None,
        *,
        invoker: discord.abc.User | None,
        show_private: bool = True,
    ) -> discord.Embed:
        snapshot = await self._snapshot(target, guild)
        profile: UserProfile | None = self.store.get(target.id)
        is_staff = self._is_staff(invoker, guild)

        visible = profile.sorted_accounts(is_staff=is_staff and show_private) if profile else []
        github_profiles, github_errors = await self._github_profiles(visible)

        return embeds.build_profile_embed(
            snapshot,
            profile,
            is_staff=is_staff,
            github_profiles=github_profiles,
            github_errors=github_errors,
            requested_by=invoker.display_name if invoker else None,
            show_private=show_private,
        )

    async def _respond(
        self,
        *,
        channel: discord.abc.Messageable,
        targets: list[discord.abc.User],
        guild: discord.Guild | None,
        invoker: discord.abc.User | None,
        show_private: bool = True,
    ) -> None:
        embeds_out: list[discord.Embed] = []
        for target in targets[:MAX_TARGETS_PER_MESSAGE]:
            embeds_out.append(
                await self.build_embed(target, guild, invoker=invoker, show_private=show_private)
            )
        if not embeds_out:
            return
        try:
            await channel.send(embeds=embeds_out, allowed_mentions=discord.AllowedMentions.none())
        except discord.Forbidden:
            LOGGER.warning("Thiếu quyền gửi embed ở kênh %s", getattr(channel, "id", "?"))
        except discord.HTTPException as exc:
            LOGGER.error("Gửi embed thất bại: %s", exc)

    # -- đăng ký lệnh ------------------------------------------------------- #
    def _register_commands(self) -> None:
        cfg = self.cfg

        @self.tree.command(name="whois", description="Xem hồ sơ chi tiết của một người dùng")
        @app_commands.describe(
            user="Người dùng cần xem (chọn hoặc dán ID)",
            rieng_tu="Chỉ mình bạn thấy kết quả",
        )
        @app_commands.guild_only()
        async def whois(
            interaction: discord.Interaction,
            user: discord.User,
            rieng_tu: bool = False,
        ) -> None:
            ephemeral = rieng_tu or cfg.ephemeral
            await interaction.response.defer(ephemeral=ephemeral)
            embed = await self.build_embed(
                user,
                interaction.guild,
                invoker=interaction.user,
                show_private=ephemeral,
            )
            await interaction.followup.send(
                embed=embed, allowed_mentions=discord.AllowedMentions.none()
            )

        @self.tree.command(name="help", description="Hướng dẫn dùng bot")
        @app_commands.guild_only()
        async def help_cmd(interaction: discord.Interaction) -> None:
            await interaction.response.send_message(
                embed=embeds.build_help_embed(
                    cfg.command_prefix,
                    mention_trigger=cfg.mention_trigger,
                    privacy_enabled=cfg.privacy_role_id is not None,
                ),
                ephemeral=True,
            )

        group = app_commands.Group(
            name="taikhoan",
            description="Quản lý danh sách tài khoản liên kết đã lưu",
            default_permissions=discord.Permissions(manage_guild=True),
            guild_only=True,
        )

        @group.command(name="list", description="Liệt kê tài khoản đã lưu của một người")
        @app_commands.describe(user="Người dùng cần xem")
        @app_commands.guild_only()
        async def list_accounts(interaction: discord.Interaction, user: discord.User) -> None:
            await interaction.response.defer(ephemeral=True)
            profile = self.store.get(user.id)
            if profile is None or not profile.accounts:
                await interaction.followup.send(
                    embed=embeds.build_success_embed(
                        f"Chưa có tài khoản nào được lưu cho <@{user.id}>.", title="Danh sách trống"
                    ),
                    ephemeral=True,
                )
                return
            lines = [
                f"• `{acc.type}/{acc.handle}` — {acc.visibility}"
                + (" · ✅" if acc.verified else "")
                + (f" · {acc.label}" if acc.label else "")
                for acc in profile.sorted_accounts(is_staff=True)
            ]
            embed = discord.Embed(
                title=f"Tài khoản đã lưu của {models.sanitize_text(user.display_name, max_len=80)}",
                description=embeds.fit_text("\n".join(lines), 4000),
                colour=embeds.DEFAULT_COLOR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

        @group.command(name="add", description="Thêm hoặc cập nhật một tài khoản liên kết")
        @app_commands.describe(
            user="Chủ sở hữu tài khoản",
            type="Loại tài khoản, ví dụ: github, steam, riot",
            handle="Tên đăng nhập / ID trên nền tảng đó",
            label="Nhãn hiển thị (tuỳ chọn)",
            url="Link tới hồ sơ (tuỳ chọn, phải là http/https)",
            visibility="public = ai cũng thấy, restricted = chỉ staff",
            verified="Đã xác minh danh tính chưa",
            note="Ghi chú ngắn (tuỳ chọn)",
        )
        @app_commands.choices(
            visibility=[
                app_commands.Choice(name="public — ai cũng thấy", value="public"),
                app_commands.Choice(name="restricted — chỉ staff", value="restricted"),
            ]
        )
        @app_commands.checks.has_permissions(manage_guild=True)
        @app_commands.guild_only()
        async def add_account(
            interaction: discord.Interaction,
            user: discord.User,
            type: str,
            handle: str,
            label: str = "",
            url: str = "",
            visibility: app_commands.Choice[str] | None = None,
            verified: bool = False,
            note: str = "",
        ) -> None:
            await interaction.response.defer(ephemeral=True)
            try:
                account = LinkedAccount.create(
                    type=type,
                    handle=handle,
                    label=label,
                    url=url,
                    visibility=visibility.value if visibility else "public",
                    verified=verified,
                    note=note,
                )
            except ValidationError as exc:
                await interaction.followup.send(
                    embed=embeds.build_error_embed(models.sanitize_text(str(exc), max_len=300)),
                    ephemeral=True,
                )
                return
            async with self._store_lock:
                is_new = self.store.upsert_account(user.id, account)
            LOGGER.info(
                "audit: %s (%s) %s tài khoản %s/%s của %s",
                interaction.user,
                interaction.user.id,
                "thêm" if is_new else "cập nhật",
                account.type,
                account.handle,
                user.id,
            )
            await interaction.followup.send(
                embed=embeds.build_success_embed(
                    f"Đã {'thêm' if is_new else 'cập nhật'} "
                    f"`{account.type}/{models.sanitize_text(account.handle, max_len=64, escape=False)}` "
                    f"cho **{models.sanitize_text(user.display_name, max_len=80)}**."
                ),
                ephemeral=True,
            )

        @group.command(name="remove", description="Xoá một tài khoản liên kết")
        @app_commands.describe(user="Chủ sở hữu tài khoản", type="Loại tài khoản", handle="Tên đăng nhập / ID")
        @app_commands.checks.has_permissions(manage_guild=True)
        @app_commands.guild_only()
        async def remove_account(
            interaction: discord.Interaction,
            user: discord.User,
            type: str,
            handle: str,
        ) -> None:
            await interaction.response.defer(ephemeral=True)
            async with self._store_lock:
                removed = self.store.remove_account(user.id, type, handle)
            if not removed:
                await interaction.followup.send(
                    embed=embeds.build_error_embed(
                        f"Không tìm thấy `{models.sanitize_text(type, max_len=32)}/"
                        f"{models.sanitize_text(handle, max_len=64)}` của {user.display_name}."
                    ),
                    ephemeral=True,
                )
                return
            LOGGER.info("audit: %s xoá tài khoản %s/%s của %s", interaction.user, type, handle, user.id)
            await interaction.followup.send(
                embed=embeds.build_success_embed(f"Đã xoá `{type}/{handle}`."), ephemeral=True
            )

        @group.command(name="note", description="Đặt ghi chú nội bộ cho một người")
        @app_commands.describe(user="Người dùng", note="Ghi chú (để trống để xoá)")
        @app_commands.checks.has_permissions(manage_guild=True)
        @app_commands.guild_only()
        async def set_note(interaction: discord.Interaction, user: discord.User, note: str = "") -> None:
            await interaction.response.defer(ephemeral=True)
            try:
                async with self._store_lock:
                    self.store.set_notes(user.id, note)
            except ValidationError as exc:
                await interaction.followup.send(
                    embed=embeds.build_error_embed(models.sanitize_text(str(exc), max_len=300)),
                    ephemeral=True,
                )
                return
            LOGGER.info("audit: %s đổi ghi chú của %s", interaction.user, user.id)
            await interaction.followup.send(
                embed=embeds.build_success_embed(
                    "Đã lưu ghi chú." if note.strip() else "Đã xoá ghi chú."
                ),
                ephemeral=True,
            )

        self.tree.add_command(group)

        @self.tree.context_menu(name="Xem tài khoản")
        async def view_accounts_menu(
            interaction: discord.Interaction, member: discord.Member
        ) -> None:
            await interaction.response.defer(ephemeral=cfg.ephemeral)
            embed = await self.build_embed(
                member, interaction.guild, invoker=interaction.user, show_private=False
            )
            await interaction.followup.send(embed=embed)

    # -- nghe mention ------------------------------------------------------- #
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None:
            return
        if self.user is None or message.author.id == self.user.id:
            return

        content = message.content or ""
        prefix_used = _matches_prefix(content, self.cfg.command_prefix)
        targets: list[discord.abc.User] = []

        if prefix_used:
            targets = [m for m in message.mentions if m.id != self.user.id]
        elif self.cfg.mention_trigger == "bot":
            if self.user in message.mentions:
                targets = [m for m in message.mentions if m.id != self.user.id]
        elif self.cfg.mention_trigger == "any" and message.type is discord.MessageType.default:
            targets = [m for m in message.mentions if m.id != self.user.id]

        if not targets:
            if (prefix_used or self.user in message.mentions) and not self._cooldown_hit(
                message.guild.id, 0
            ):
                await message.reply(
                    embed=embeds.build_help_embed(
                        self.cfg.command_prefix,
                        mention_trigger=self.cfg.mention_trigger,
                        privacy_enabled=self.cfg.privacy_role_id is not None,
                    ),
                    mention_author=False,
                    allowed_mentions=discord.AllowedMentions.none(),
                )
            return

        deduped: list[discord.abc.User] = []
        seen: set[int] = set()
        for target in targets:
            if target.id in seen:
                continue
            if self._cooldown_hit(message.guild.id, target.id):
                continue
            seen.add(target.id)
            deduped.append(target)

        if not deduped:
            LOGGER.debug("Bỏ qua mention (cooldown) ở guild %s", message.guild.id)
            return

        await self._respond(
            channel=message.channel,
            targets=deduped,
            guild=message.guild,
            invoker=message.author,
            show_private=False,
        )

    # -- xử lý lỗi lệnh slash ----------------------------------------------- #
    async def _on_app_command_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            message = "Bạn cần quyền **Quản lý server** để dùng lệnh này."
        elif isinstance(error, app_commands.CommandOnCooldown):
            message = f"Thử lại sau {error.retry_after:.0f} giây."
        elif isinstance(error, app_commands.CheckFailure):
            message = "Bạn không có quyền dùng lệnh này."
        elif isinstance(error, (StoreError, ValidationError)):
            message = "Lỗi dữ liệu: " + models.sanitize_text(str(error), max_len=300)
        else:
            LOGGER.exception("Lỗi lệnh slash chưa xử lý", exc_info=error)
            message = "Có lỗi khi xử lý. Xem log của bot để biết chi tiết."

        embed = embeds.build_error_embed(message)
        try:
            if interaction.response.is_done():
                await interaction.followup.send(embed=embed, ephemeral=True)
            else:
                await interaction.response.send_message(embed=embed, ephemeral=True)
        except discord.HTTPException:
            pass


# --------------------------------------------------------------------------- #
# Entrypoint
# --------------------------------------------------------------------------- #
def main() -> int:
    load_dotenv()
    try:
        cfg = from_env()
    except ConfigError as exc:
        print(f"[cấu hình] {exc}", file=sys.stderr)
        return 2

    setup_logging(cfg.log_level)
    LOGGER.info("Cấu hình: %s", cfg.redacted())
    if cfg.mention_trigger != "off":
        LOGGER.info(
            "Đang bật đọc nội dung tin nhắn — nhớ bật MESSAGE CONTENT INTENT "
            "trong Discord Developer Portal, nếu không bot sẽ không thấy mention."
        )
    if cfg.presence_intent:
        LOGGER.info("Đang bật PRESENCE INTENT — nhớ bật trong Developer Portal.")

    # Kiểm tra dữ liệu trước khi đăng nhập: hỏng thì báo ngay, không chờ login.
    try:
        AccountStore(cfg.data_path).load()
    except StoreError as exc:
        LOGGER.error("Không nạp được dữ liệu: %s", exc)
        return 3

    bot = AccountBot(cfg)
    try:
        bot.run(cfg.token, log_handler=None)
    except StoreError as exc:
        LOGGER.error("Không nạp được dữ liệu: %s", exc)
        return 3
    except discord.LoginFailure:
        LOGGER.error("DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi.")
        return 4
    except discord.PrivilegedIntentsRequired:
        LOGGER.error(
            "Tài khoản bot chưa bật privileged intents cần thiết "
            "(MESSAGE CONTENT / SERVER MEMBERS / PRESENCE) trong Developer Portal."
        )
        return 5
    except KeyboardInterrupt:
        LOGGER.info("Dừng theo yêu cầu.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
