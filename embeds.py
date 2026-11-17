"""Dựng nội dung embed Discord từ dữ liệu thuần (``models``).

Tách khỏi ``bot.py`` để test được không cần token hay kết nối Discord.
"""

from __future__ import annotations

import discord

from github_api import GitHubProfile
from models import (
    LinkedAccount,
    UserProfile,
    UserSnapshot,
    human_delta,
    sanitize_text,
    strip_invisible,
    utc_now,
)

DEFAULT_COLOR = 0x5865F2
OK_COLOR = 0x57F287
WARN_COLOR = 0xFEE75C
ERROR_COLOR = 0xED4245

FIELD_VALUE_LIMIT = 1024
MAX_FIELD_NOTE = 480
FIELD_NAME_LIMIT = 256
DESCRIPTION_LIMIT = 4096
EMBED_TOTAL_LIMIT = 5800  # Discord cho 6000, chừa biên

STATUS_LABELS = {
    "online": "🟢 Đang online",
    "idle": "🌙 Treo máy (idle)",
    "dnd": "⛔ Không làm phiền",
    "offline": "⚫ Offline",
    "invisible": "⚫ Ẩn (invisible)",
}

FLAG_LABELS = {
    "staff": "Nhân viên Discord",
    "partner": "Đối tác Discord",
    "hypesquad": "HypeSquad Events",
    "bug_hunter": "Bug Hunter",
    "bug_hunter_level_2": "Bug Hunter Lv2",
    "hypesquad_bravery": "HypeSquad Bravery",
    "hypesquad_brilliance": "HypeSquad Brilliance",
    "hypesquad_balance": "HypeSquad Balance",
    "early_supporter": "Early Supporter",
    "verified_bot": "Bot đã xác minh",
    "verified_bot_developer": "Nhà phát triển bot đã xác minh",
    "active_developer": "Active Developer",
    "system": "System",
}

ACCOUNT_TYPE_LABELS = {
    "github": "GitHub",
    "gitlab": "GitLab",
    "steam": "Steam",
    "riot": "Riot Games",
    "roblox": "Roblox",
    "minecraft": "Minecraft",
    "epic": "Epic Games",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "tiktok": "TikTok",
    "youtube": "YouTube",
    "twitter": "X / Twitter",
    "discord": "Discord khác",
    "email": "Email",
    "website": "Website",
    "khac": "Khác",
}


# --------------------------------------------------------------------------- #
# Tiện ích nội bộ
# --------------------------------------------------------------------------- #
def _fit(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def fit_text(text: str, limit: int) -> str:
    """Cắt ngắn văn bản kèm dấu "…" (public, dùng cho CLI/lệnh phụ)."""
    return _fit(text, limit)


def _ts(value) -> str:
    """Định dạng timestamp Discord (tự đổi theo timezone người xem)."""
    absolute = discord.utils.format_dt(value, "f")
    relative = discord.utils.format_dt(value, "R")
    return f"{absolute} · {relative}"


def _plain(text: str, limit: int) -> str:
    """Văn bản bot tự soạn: chỉ cần bỏ ký tự vô hình + cắt ngắn (không escape)."""
    return _fit(strip_invisible(str(text)), limit)


def _inline_code(value: str, limit: int = 64) -> str:
    """Bọc trong câu lệnh code: không ping, chỉ cần loại bỏ backtick."""
    cleaned = sanitize_text(value, max_len=limit, escape=False).replace("`", "'")
    return f"`{cleaned}`"


def _safe_url(url: str) -> str:
    return url.replace("(", "%28").replace(")", "%29").replace(" ", "%20")


def _type_label(account_type: str) -> str:
    key = account_type.lower()
    return ACCOUNT_TYPE_LABELS.get(key, key.upper() if len(key) <= 4 else key.capitalize())


def _account_line(account: LinkedAccount) -> str:
    label = sanitize_text(account.label or account.handle, max_len=64)
    handle = sanitize_text(account.handle, max_len=64) if account.label else ""
    head = f"**{label}**" + (f" · {_inline_code(account.handle)}" if handle else "")
    if account.url:
        head = f"[{head}]({_safe_url(account.url)})"
    marks = [f"__{_type_label(account.type)}__"]
    if account.verified:
        marks.append("✅ đã xác minh")
    if not account.is_public():
        marks.append("🔒 nội bộ")
    line = f"• {head} — " + " · ".join(marks)
    if account.note:
        line += f"\n   ↳ {sanitize_text(account.note, max_len=200, single_line=False)}"
    if account.added_at:
        line += f"\n   ↳ thêm {human_delta(account.added_at)} trước"
    return line


def _account_lines(accounts: list[LinkedAccount], *, limit: int = FIELD_VALUE_LIMIT) -> str:
    if not accounts:
        return "_Chưa có tài khoản liên kết nào được lưu._"
    lines: list[str] = []
    used = 0
    for index, account in enumerate(accounts):
        line = _account_line(account)
        remaining = len(accounts) - index - 1
        if used + len(line) > limit - 40:
            lines.append(f"_… còn {remaining + 1} tài khoản nữa (xem bằng lệnh `/taikhoan list`)._")
            break
        lines.append(line)
        used += len(line) + 1
    return _fit("\n".join(lines), limit)


def _github_lines(
    profiles: dict[str, GitHubProfile],
    errors: dict[str, str],
) -> str:
    lines: list[str] = []
    for login in sorted(profiles):
        profile = profiles[login]
        login_text = sanitize_text(profile.login, max_len=40)
        bits = [f"[**{login_text}**]({_safe_url(profile.html_url)})"]
        if profile.name:
            bits.append(profile.name)
        stats = f"{profile.public_repos} repo · {profile.followers} follower"
        bits.append(stats)
        line = "• " + " — ".join(bits)
        extra: list[str] = []
        if profile.bio:
            extra.append(f"_{profile.bio}_")
        if profile.company or profile.location:
            extra.append(" · ".join(x for x in (profile.company, profile.location) if x))
        if profile.created_at:
            extra.append(f"tạo tài khoản {human_delta(profile.created_at)} trước")
        if extra:
            line += "\n   ↳ " + "\n   ↳ ".join(extra)
        lines.append(line)
    for login in sorted(errors):
        lines.append(
            f"• **{sanitize_text(login, max_len=40)}** — ⚠️ {sanitize_text(errors[login], max_len=120)}"
        )
    return _fit("\n".join(lines), FIELD_VALUE_LIMIT)


class _Budget:
    """Giữ tổng độ dài embed dưới giới hạn của Discord."""

    def __init__(self, limit: int = EMBED_TOTAL_LIMIT) -> None:
        self.limit = limit
        self.used = 0

    def take(self, size: int) -> int:
        """Xin ``size`` ký tự, trả về số ký tự thực sự còn trống."""
        available = max(0, self.limit - self.used)
        granted = min(size, available)
        self.used += granted
        return granted


# --------------------------------------------------------------------------- #
# Embed chính
# --------------------------------------------------------------------------- #
def build_profile_embed(
    snapshot: UserSnapshot,
    profile: UserProfile | None,
    *,
    is_staff: bool,
    github_profiles: dict[str, GitHubProfile] | None = None,
    github_errors: dict[str, str] | None = None,
    requested_by: str | None = None,
    show_private: bool = True,
) -> discord.Embed:
    """Embed giới thiệu chi tiết một người dùng.

    ``show_private=False`` (ví dụ khi dùng trong DM hoặc kênh công khai bị hạn
    chế) sẽ ẩn ghi chú nội bộ và tài khoản có ``visibility=restricted``.
    """
    github_profiles = github_profiles or {}
    github_errors = github_errors or {}
    staff_view = is_staff and show_private
    budget = _Budget()

    top_role = snapshot.top_role()
    color = DEFAULT_COLOR
    if top_role is not None and top_role.color:
        color = top_role.color
    elif snapshot.accent_color:
        color = snapshot.accent_color

    title_name = sanitize_text(snapshot.display_name or snapshot.username, max_len=80) or "Người dùng"
    title = f"Hồ sơ: {title_name}"
    budget.take(len(title))

    embed = discord.Embed(title=_fit(title, 256), colour=color)
    if snapshot.avatar_url:
        embed.set_thumbnail(url=snapshot.avatar_url)

    # --- Tài khoản Discord -------------------------------------------------- #
    identity: list[str] = [
        f"**ID:** `{snapshot.user_id}`",
        f"**Username:** {_inline_code(snapshot.username)}",
    ]
    if snapshot.nickname and snapshot.nickname != snapshot.display_name:
        identity.append(f"**Biệt danh (server):** {sanitize_text(snapshot.nickname, max_len=64)}")
    if snapshot.is_bot:
        identity.append("**Loại:** 🤖 Bot")
    if snapshot.created_at:
        identity.append(f"**Tạo tài khoản:** {_ts(snapshot.created_at)}")
    if snapshot.joined_at:
        identity.append(f"**Vào server:** {_ts(snapshot.joined_at)}")
    elif snapshot.guild_name:
        identity.append("**Vào server:** _không có trong server này_")
    if snapshot.boost_since:
        identity.append(f"**Boost từ:** {_ts(snapshot.boost_since)}")
    if snapshot.status:
        identity.append(f"**Trạng thái:** {STATUS_LABELS.get(snapshot.status, snapshot.status)}")
    if snapshot.activities:
        acts = ", ".join(sanitize_text(a, max_len=40) for a in snapshot.activities[:3])
        identity.append(f"**Hoạt động:** {acts}")
    if snapshot.public_flags:
        flags = ", ".join(FLAG_LABELS.get(flag, flag) for flag in snapshot.public_flags[:6])
        identity.append(f"**Huy hiệu:** {flags}")

    identity_text = _fit("\n".join(identity), min(FIELD_VALUE_LIMIT, budget.take(len("\n".join(identity)))))
    embed.add_field(name="👤 Tài khoản Discord", value=identity_text or "—", inline=False)

    # --- Vai trò ------------------------------------------------------------ #
    roles = snapshot.role_names(limit=15)
    if roles or top_role:
        header = []
        if top_role:
            header.append(f"**Vai trò cao nhất:** {sanitize_text(top_role.name, max_len=64)}")
        if roles:
            header.append(
                f"**Vai trò ({len(snapshot.roles) - 1}):** "
                + ", ".join(sanitize_text(r, max_len=40) for r in roles)
            )
            if len(snapshot.roles) - 1 > len(roles):
                header.append(f"_… và {len(snapshot.roles) - 1 - len(roles)} vai trò khác_")
        text = _fit("\n".join(header), min(FIELD_VALUE_LIMIT, budget.take(len("\n".join(header)))))
        if text.strip():
            embed.add_field(name="🎭 Vai trò", value=text, inline=False)

    # --- Tài khoản liên kết ------------------------------------------------- #
    accounts = profile.sorted_accounts(is_staff=staff_view) if profile else []
    hidden = 0
    if profile and is_staff and not show_private:
        hidden = len(profile.visible_accounts(is_staff=True)) - len(accounts)
    accounts_text = _account_lines(accounts)
    if hidden:
        accounts_text += f"\n_🔒 {hidden} tài khoản nội bộ bị ẩn ở ngữ cảnh này._"
    granted = budget.take(len(accounts_text))
    if granted < 20:
        accounts_text = "_Không đủ chỗ hiển thị trong embed._"
    embed.add_field(name="🔗 Tài khoản liên kết", value=_fit(accounts_text, FIELD_VALUE_LIMIT), inline=False)

    # --- Ghi chú nội bộ ----------------------------------------------------- #
    if profile and profile.notes and staff_view:
        escaped_notes = sanitize_text(profile.notes, max_len=MAX_FIELD_NOTE, single_line=False)
        notes = _fit(escaped_notes, min(FIELD_VALUE_LIMIT, max(0, budget.take(len(escaped_notes)))))
        if notes.strip():
            embed.add_field(name="📝 Ghi chú nội bộ", value=notes, inline=False)

    # --- Hồ sơ GitHub công khai --------------------------------------------- #
    if github_profiles or github_errors:
        text = _github_lines(github_profiles, github_errors)
        if budget.take(len(text)) >= 20:
            embed.add_field(name="🐙 GitHub (công khai)", value=text, inline=False)

    # --- Footer ------------------------------------------------------------- #
    if profile and profile.updated_at:
        embed.set_footer(
            text=_fit(
                ("Yêu cầu bởi " + requested_by + " · " if requested_by else "")
                + f"Dữ liệu nội bộ cập nhật {human_delta(profile.updated_at)} trước",
                200,
            )
        )
    elif requested_by:
        embed.set_footer(text=_fit("Yêu cầu bởi " + requested_by, 200))
    embed.timestamp = utc_now()
    return embed


# --------------------------------------------------------------------------- #
# Các embed phụ trợ
# --------------------------------------------------------------------------- #
def build_error_embed(message: str, *, title: str = "Không xử lý được") -> discord.Embed:
    """Embed lỗi. ``message`` phải là văn bản an toàn (escape trước nếu từ người dùng)."""
    return discord.Embed(
        title=_plain(title, 256) or "Lỗi",
        description=_plain(message, DESCRIPTION_LIMIT),
        colour=ERROR_COLOR,
    )


def build_success_embed(message: str, *, title: str = "Xong") -> discord.Embed:
    """Embed xác nhận. ``message`` phải là văn bản an toàn (escape trước nếu từ người dùng)."""
    return discord.Embed(
        title=_plain(title, 256) or "Xong",
        description=_plain(message, DESCRIPTION_LIMIT),
        colour=OK_COLOR,
    )


def build_help_embed(prefix: str, *, mention_trigger: str, privacy_enabled: bool) -> discord.Embed:
    embed = discord.Embed(
        title="Bot giới thiệu tài khoản",
        description=(
            "Mention một người để xem hồ sơ chi tiết, hoặc dùng lệnh bên dưới.\n"
            "Bot chỉ đọc dữ liệu công khai của Discord và dữ liệu do admin của "
            "server nhập vào — không truy cập tài khoản riêng tư của ai."
        ),
        colour=DEFAULT_COLOR,
    )
    triggers = {
        "bot": f"Mention bot rồi mention người cần xem: `@Bot @user`\nHoặc `{prefix} @user`",
        "any": f"Mention bất kỳ ai: `@user` (bot sẽ trả lời)\nHoặc `{prefix} @user`",
        "off": f"Đã tắt chế độ mention. Dùng `{prefix} @user` hoặc `/whois`.",
    }
    embed.add_field(name="Cách dùng", value=triggers.get(mention_trigger, triggers["bot"]), inline=False)
    embed.add_field(
        name="Lệnh slash",
        value=(
            "`/whois user:@ai_do` — xem hồ sơ\n"
            "`/taikhoan list user:@ai_do` — liệt kê tài khoản đã lưu\n"
            "`/taikhoan add` `/taikhoan remove` `/taikhoan note` — quản lý (cần quyền Quản lý server)\n"
            "`/help` — trợ giúp này"
        ),
        inline=False,
    )
    if privacy_enabled:
        embed.add_field(
            name="Riêng tư",
            value="Mục `🔒 nội bộ` chỉ hiển thị với người có role được cấu hình (`PRIVACY_ROLE_ID`).",
            inline=False,
        )
    embed.set_footer(text="Dữ liệu do server tự quản lý · không chia sẻ ra ngoài")
    return embed
