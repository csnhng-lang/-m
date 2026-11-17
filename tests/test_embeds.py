"""Test cho việc dựng embed (giới hạn ký tự, phân quyền hiển thị, an toàn markdown)."""

from __future__ import annotations

from datetime import timedelta

import discord
import pytest

import embeds
from github_api import GitHubProfile
from models import LinkedAccount, RoleInfo, UserProfile, UserSnapshot, utc_now


def make_snapshot(**overrides) -> UserSnapshot:
    now = utc_now()
    base = {
        "user_id": 123456789012345678,
        "username": "csnhng",
        "display_name": "Cao Sỹ Nhân",
        "nickname": "nhan",
        "created_at": now - timedelta(days=900),
        "joined_at": now - timedelta(days=120),
        "guild_name": "Test Guild",
        "roles": [
            RoleInfo(name="@everyone", position=0, is_default=True),
            RoleInfo(name="Admin", position=7, color=0x00FF00),
            RoleInfo(name="Dev", position=3, color=0x0000FF),
        ],
        "boost_since": now - timedelta(days=10),
        "status": "online",
        "activities": ["Visual Studio Code"],
        "avatar_url": "https://cdn.discordapp.com/embed/avatars/0.png",
        "banner_url": None,
        "public_flags": ["active_developer", "early_supporter"],
        "accent_color": 0x123456,
    }
    base.update(overrides)
    return UserSnapshot(**base)


def make_profile(accounts: int = 3) -> UserProfile:
    profile = UserProfile(user_id="123456789012345678", notes="Ghi chú nội bộ: đã xác minh CCCD.")
    for i in range(accounts):
        profile.upsert(
            LinkedAccount.create(
                type="github" if i % 2 == 0 else "steam",
                handle=f"user{i}",
                label=f"Tài khoản {i}",
                url=f"https://example.com/{i}",
                visibility="restricted" if i == accounts - 1 else "public",
            )
        )
    return profile


class TestProfileEmbed:
    def test_basic_fields_present(self):
        embed = embeds.build_profile_embed(make_snapshot(), make_profile(), is_staff=False)
        names = [f.name for f in embed.fields]
        assert "👤 Tài khoản Discord" in names
        assert "🔗 Tài khoản liên kết" in names
        assert embed.title.startswith("Hồ sơ:")

    def test_restricted_hidden_from_non_staff(self):
        embed = embeds.build_profile_embed(make_snapshot(), make_profile(3), is_staff=False)
        accounts_field = next(f for f in embed.fields if "liên kết" in f.name)
        assert "user2" not in accounts_field.value  # restricted
        assert "user0" in accounts_field.value

    def test_restricted_shown_to_staff_in_private_context(self):
        embed = embeds.build_profile_embed(
            make_snapshot(), make_profile(3), is_staff=True, show_private=True
        )
        accounts_field = next(f for f in embed.fields if "liên kết" in f.name)
        assert "user2" in accounts_field.value

    def test_staff_public_context_hides_restricted_with_hint(self):
        embed = embeds.build_profile_embed(
            make_snapshot(), make_profile(3), is_staff=True, show_private=False
        )
        accounts_field = next(f for f in embed.fields if "liên kết" in f.name)
        assert "user2" not in accounts_field.value
        assert "bị ẩn" in accounts_field.value

    def test_notes_only_for_staff(self):
        public = embeds.build_profile_embed(make_snapshot(), make_profile(), is_staff=False)
        staff = embeds.build_profile_embed(make_snapshot(), make_profile(), is_staff=True)
        assert not any("Ghi chú" in f.name for f in public.fields)
        assert any("Ghi chú" in f.name for f in staff.fields)

    def test_no_profile_still_renders(self):
        embed = embeds.build_profile_embed(make_snapshot(), None, is_staff=False)
        accounts_field = next(f for f in embed.fields if "liên kết" in f.name)
        assert "Chưa có tài khoản" in accounts_field.value

    def test_member_not_in_guild(self):
        embed = embeds.build_profile_embed(
            make_snapshot(joined_at=None, roles=[], guild_name="G"), None, is_staff=False
        )
        assert "👤 Tài khoản Discord" in [f.name for f in embed.fields]

    def test_color_from_top_role(self):
        embed = embeds.build_profile_embed(make_snapshot(), None, is_staff=False)
        assert embed.colour.value == 0x00FF00

    def test_markdown_injection_neutralised(self):
        snap = make_snapshot(display_name="@everyone **hacked**", nickname=None)
        profile = UserProfile(
            user_id="1", accounts=[LinkedAccount.create(type="github", handle="**x**")]
        )
        embed = embeds.build_profile_embed(snap, profile, is_staff=False)
        assert "**hacked**" not in embed.title
        text = "\n".join(f.value for f in embed.fields)
        assert "\\*\\*x\\*\\*" in text

    def test_github_section(self):
        profile = make_profile(1)
        gh = GitHubProfile(
            login="user0",
            html_url="https://github.com/user0",
            name="User Zero",
            bio="dev",
            public_repos=12,
            followers=34,
            created_at=utc_now() - timedelta(days=400),
        )
        embed = embeds.build_profile_embed(
            make_snapshot(), profile, is_staff=False, github_profiles={"user0": gh}
        )
        field = next((f for f in embed.fields if "GitHub" in f.name), None)
        assert field is not None
        assert "12 repo" in field.value and "34 follower" in field.value

    def test_github_errors_are_reported_not_crashing(self):
        embed = embeds.build_profile_embed(
            make_snapshot(),
            make_profile(1),
            is_staff=False,
            github_errors={"user0": "Hết quota GitHub API"},
        )
        field = next((f for f in embed.fields if "GitHub" in f.name), None)
        assert field is not None and "quota" in field.value

    def test_footer_mentions_requester(self):
        embed = embeds.build_profile_embed(
            make_snapshot(), make_profile(), is_staff=False, requested_by="Admin"
        )
        assert "Admin" in (embed.footer.text or "")


class TestLimits:
    def _stress_profile(self) -> UserProfile:
        profile = UserProfile(user_id="1", notes="n" * 500)
        for i in range(40):
            profile.upsert(
                LinkedAccount.create(
                    type="github",
                    handle=f"very-long-handle-{i}-" + "x" * 20,
                    label="Nhãn dài " + "y" * 40,
                    url=f"https://example.com/{i}",
                    note="ghi chú " + "z" * 120,
                    visibility="public",
                )
            )
        return profile

    def test_total_length_within_discord_limit(self):
        snap = make_snapshot(
            roles=[RoleInfo(name=f"Vai trò rất dài {i}" + "a" * 20, position=i) for i in range(60)],
            activities=["a" * 100, "b" * 100, "c" * 100],
            public_flags=["active_developer"] * 10,
        )
        embed = embeds.build_profile_embed(snap, self._stress_profile(), is_staff=True)
        assert len(embed) <= 6000, f"embed quá dài: {len(embed)}"
        for field in embed.fields:
            assert len(field.name) <= 256
            assert len(field.value) <= 1024

    def test_field_value_never_exceeds_limit(self):
        embed = embeds.build_profile_embed(make_snapshot(), self._stress_profile(), is_staff=True)
        for field in embed.fields:
            assert len(field.value) <= 1024


class TestHelperEmbeds:
    def test_error_embed_is_truncated(self):
        embed = embeds.build_error_embed("x" * 5000)
        assert len(embed.description) <= 4096

    def test_helper_embeds_keep_safe_markdown(self):
        # Caller chịu trách nhiệm escape dữ liệu người dùng; helper không escape lại.
        embed = embeds.build_error_embed("**boom**")
        assert "**boom**" in embed.description

    def test_helper_embeds_strip_invisible_chars(self):
        embed = embeds.build_success_embed("a\u200bb\u202ec")
        assert "\u200b" not in embed.description

    def test_help_embed_variants(self):
        for trigger in ("bot", "any", "off"):
            embed = embeds.build_help_embed("!info", mention_trigger=trigger, privacy_enabled=True)
            assert embed.title
            assert len(embed) <= 6000
        assert "Riêng tư" in [f.name for f in embeds.build_help_embed(
            "!info", mention_trigger="bot", privacy_enabled=True
        ).fields]

    def test_fit_text(self):
        assert embeds.fit_text("abcdef", 4) == "abc…"
        assert embeds.fit_text("abc", 10) == "abc"


def test_embed_uses_discord_objects_only():
    """Đảm bảo hàm dựng embed không phụ thuộc trạng thái toàn cục."""
    embed = embeds.build_profile_embed(make_snapshot(), make_profile(), is_staff=False)
    assert isinstance(embed, discord.Embed)
    with pytest.raises((TypeError, AttributeError)):
        embeds.build_profile_embed(None, None, is_staff=False)  # type: ignore[arg-type]
