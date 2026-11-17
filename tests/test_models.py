"""Test cho lớp dữ liệu thuần (models)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from models import (
    LinkedAccount,
    RoleInfo,
    UserProfile,
    UserSnapshot,
    ValidationError,
    clean_display_name,
    clean_notes,
    escape_markdown,
    human_delta,
    sanitize_text,
    strip_invisible,
    utc_now,
)


class TestSanitize:
    def test_escape_markdown(self):
        assert escape_markdown("a*b_c") == "a\\*b\\_c"

    def test_mentions_and_links_neutralised(self):
        cleaned = sanitize_text("@everyone **bold** [x](http://evil)")
        assert "@everyone" not in cleaned.replace("\\@everyone", "")  # đã escape
        assert "\\*\\*bold\\*\\*" in cleaned
        assert "\\[x\\]\\(http://evil\\)" in cleaned

    def test_strips_zero_width_and_rtl_override(self):
        raw = "ad\u200bmin\u202e\u200f"
        assert strip_invisible(raw) == "admin"

    def test_collapses_newlines_when_single_line(self):
        assert sanitize_text("a\n\nb", single_line=True) == "a b"
        assert sanitize_text("a\n\nb", single_line=False, escape=False) == "a\n\nb"

    def test_truncates_with_ellipsis(self):
        out = sanitize_text("x" * 50, max_len=10)
        assert len(out) == 10 and out.endswith("…")

    def test_keeps_vietnamese_diacritics(self):
        assert sanitize_text("Nguyễn Đức Anh") == "Nguyễn Đức Anh"

    def test_none_and_non_string(self):
        assert sanitize_text(None) == ""
        assert sanitize_text(123) == "123"

    def test_display_name_and_notes_helpers(self):
        assert clean_display_name(None) == ""
        assert clean_notes("dòng 1\ndòng 2") == "dòng 1\ndòng 2"
        with pytest.raises(ValidationError):
            clean_notes("x" * 501)


class TestHumanDelta:
    def test_units(self):
        now = utc_now()
        assert human_delta(now - timedelta(seconds=10), now) == "10 giây"
        assert human_delta(now - timedelta(minutes=5), now) == "5 phút"
        assert human_delta(now - timedelta(hours=3), now) == "3 giờ"
        assert human_delta(now - timedelta(days=3), now) == "3 ngày"
        assert human_delta(now - timedelta(days=45), now).startswith("1 tháng")
        assert human_delta(now - timedelta(days=800), now).startswith("2 năm")

    def test_future_is_clamped(self):
        now = utc_now()
        assert human_delta(now + timedelta(days=1), now) == "vừa xong"

    def test_naive_datetime_is_treated_as_utc(self):
        naive = datetime(2020, 1, 1)
        assert human_delta(naive, datetime(2021, 1, 1, tzinfo=UTC)).startswith("1 năm")


class TestLinkedAccount:
    def test_valid(self):
        acc = LinkedAccount.create(type="github", handle="csnhng-lang", label="GitHub chính")
        assert acc.type == "github"
        assert acc.added_at is not None
        assert acc.is_public()

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"type": "", "handle": "x"},
            {"type": "git hub", "handle": "x"},
            {"type": "github", "handle": ""},
            {"type": "github", "handle": "x", "url": "javascript:alert(1)"},
            {"type": "github", "handle": "x", "visibility": "secret"},
            {"type": "github", "handle": "x", "label": "y" * 65},
        ],
    )
    def test_invalid(self, kwargs):
        with pytest.raises(ValidationError):
            LinkedAccount.create(**kwargs)

    def test_roundtrip(self):
        acc = LinkedAccount.create(
            type="steam", handle="gaben", url="https://steamcommunity.com/id/gaben", verified=True
        )
        again = LinkedAccount.from_dict(acc.to_dict())
        assert again == acc

    def test_from_dict_rejects_bad_verified_type(self):
        with pytest.raises(ValidationError):
            LinkedAccount.from_dict({"type": "github", "handle": "x", "verified": "yes"})

    def test_key_is_case_insensitive(self):
        assert LinkedAccount.create(type="GitHub", handle="ABC").key() == ("github", "abc")


class TestUserProfile:
    def _profile(self) -> UserProfile:
        profile = UserProfile(user_id="1")
        profile.upsert(LinkedAccount.create(type="github", handle="a", visibility="public"))
        profile.upsert(LinkedAccount.create(type="steam", handle="b", visibility="restricted"))
        return profile

    def test_upsert_updates_existing(self):
        profile = self._profile()
        assert profile.upsert(LinkedAccount.create(type="github", handle="A", label="mới")) is False
        assert len(profile.accounts) == 2

    def test_visibility_filtering(self):
        profile = self._profile()
        assert [a.handle for a in profile.visible_accounts(is_staff=False)] == ["a"]
        assert len(profile.visible_accounts(is_staff=True)) == 2

    def test_remove(self):
        profile = self._profile()
        assert profile.remove("github", "a") is True
        assert profile.remove("github", "a") is False
        assert len(profile.accounts) == 1

    def test_from_dict_duplicate_accounts_rejected(self):
        raw = {
            "accounts": [
                {"type": "github", "handle": "a"},
                {"type": "github", "handle": "A"},
            ]
        }
        with pytest.raises(ValidationError):
            UserProfile.from_dict("1", raw)


class TestUserSnapshot:
    def test_top_role_ignores_everyone(self):
        snap = UserSnapshot(
            user_id=1,
            username="u",
            display_name="U",
            roles=[
                RoleInfo(name="@everyone", position=0, is_default=True),
                RoleInfo(name="Mod", position=5, color=0xFF0000),
                RoleInfo(name="Admin", position=9, color=0x00FF00),
            ],
        )
        top = snap.top_role()
        assert top is not None and top.name == "Admin"
        assert snap.role_names() == ["Admin", "Mod"]

    def test_role_names_limit(self):
        snap = UserSnapshot(
            user_id=1,
            username="u",
            display_name="U",
            roles=[RoleInfo(name=f"r{i}", position=i) for i in range(30)],
        )
        assert len(snap.role_names(limit=5)) == 5
