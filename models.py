"""Kiểu dữ liệu thuần và tiện ích làm sạch văn bản.

Module này cố tình KHÔNG import discord.py để có thể test độc lập và tái sử
dụng cho CLI. Mọi thứ từ Discord/GitHub đều phải đi qua ``sanitize_text``
trước khi vào embed, vì tên người dùng có thể chứa markdown, ``@everyone``
hoặc ký tự vô hình để giả mạo hiển thị.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

MAX_ACCOUNT_TYPE_LEN = 32
MAX_HANDLE_LEN = 64
MAX_LABEL_LEN = 64
MAX_NOTE_LEN = 500
MAX_DISPLAY_NAME_LEN = 64
MAX_URL_LEN = 300

VISIBILITY_PUBLIC = "public"
VISIBILITY_RESTRICTED = "restricted"
VISIBILITIES: tuple[str, ...] = (VISIBILITY_PUBLIC, VISIBILITY_RESTRICTED)

_ACCOUNT_TYPE_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]*$")
_URL_RE = re.compile(r"^https?://[^\s<>\"']+$")
# Ký tự có thể bị lợi dụng để chèn markdown / ping / link giả trong embed.
_MD_SPECIALS = frozenset("\\*_~|`>[]()<@#&")
# Nhóm Unicode vô hình: control, format (zero-width, RTL override...), surrogate.
_INVISIBLE_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn"})


class ValidationError(ValueError):
    """Dữ liệu không hợp lệ (từ store, CLI hoặc lệnh Discord)."""


# --------------------------------------------------------------------------- #
# Làm sạch văn bản
# --------------------------------------------------------------------------- #
def strip_invisible(value: str) -> str:
    """Bỏ ký tự điều khiển/vô hình, giữ lại xuống dòng và tab."""
    out: list[str] = []
    for ch in value:
        if ch in "\n\t":
            out.append(ch)
            continue
        if unicodedata.category(ch) in _INVISIBLE_CATEGORIES:
            continue
        if ch in "\u2028\u2029":  # line/paragraph separator
            out.append("\n")
            continue
        out.append(ch)
    return "".join(out)


def escape_markdown(value: str) -> str:
    """Escape ký tự markdown để nội dung người dùng nhập hiển thị nguyên văn."""
    return "".join("\\" + ch if ch in _MD_SPECIALS else ch for ch in value)


def sanitize_text(
    value: Any,
    *,
    max_len: int = 200,
    single_line: bool = True,
    escape: bool = True,
) -> str:
    """Chuẩn hoá văn bản do người dùng cung cấp trước khi đưa vào embed.

    - Chuẩn hoá Unicode NFC (giữ nguyên dấu tiếng Việt).
    - Bỏ ký tự vô hình/điều khiển.
    - Gộp khoảng trắng (hoặc giữ xuống dòng nếu ``single_line=False``).
    - Escape markdown.
    - Cắt ngắn kèm dấu "…".
    """
    if value is None:
        return ""
    text = strip_invisible(str(value)).replace("\r\n", "\n").replace("\r", "\n")
    text = unicodedata.normalize("NFC", text)
    if single_line:
        text = re.sub(r"\s+", " ", text)
    else:
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()
    if escape:
        text = escape_markdown(text)
    if max_len > 0 and len(text) > max_len:
        text = text[: max_len - 1].rstrip() + "…"
    return text


# --------------------------------------------------------------------------- #
# Thời gian
# --------------------------------------------------------------------------- #
def ensure_utc(value: datetime) -> datetime:
    """Trả về datetime có timezone (mặc định UTC nếu naive)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def human_delta(then: datetime, now: datetime | None = None) -> str:
    """Khoảng thời gian dạng tiếng Việt: "3 năm 2 tháng", "5 ngày", "2 giờ"."""
    now = ensure_utc(now or utc_now())
    then = ensure_utc(then)
    seconds = int((now - then).total_seconds())
    if seconds < 0:
        return "vừa xong"
    if seconds < 60:
        return f"{seconds} giây"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} phút"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} giờ"
    days = hours // 24
    if days < 30:
        return f"{days} ngày"
    if days < 365:
        months, rem_days = divmod(days, 30)
        return f"{months} tháng" + (f" {rem_days} ngày" if rem_days else "")
    years, rem_days = divmod(days, 365)
    months = rem_days // 30
    return f"{years} năm" + (f" {months} tháng" if months else "")


def isoformat(value: datetime | None) -> str | None:
    return ensure_utc(value).isoformat() if value else None


def parse_iso(value: Any, *, context: str = "") -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{context}: thời gian phải là chuỗi ISO 8601")
    try:
        return ensure_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError as exc:
        raise ValidationError(f"{context}: thời gian không hợp lệ ({value!r})") from exc


# --------------------------------------------------------------------------- #
# Tài khoản liên kết
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class LinkedAccount:
    """Một tài khoản (GitHub, Steam, Riot, ...) gắn với một người dùng Discord."""

    type: str
    handle: str
    label: str = ""
    url: str = ""
    visibility: str = VISIBILITY_PUBLIC
    verified: bool = False
    note: str = ""
    added_at: datetime | None = None

    # -- chuẩn hoá ---------------------------------------------------------- #
    def key(self) -> tuple[str, str]:
        return (self.type.lower(), self.handle.lower())

    def is_public(self) -> bool:
        return self.visibility == VISIBILITY_PUBLIC

    # -- (de)serialize ------------------------------------------------------ #
    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "type": self.type,
            "handle": self.handle,
            "visibility": self.visibility,
            "verified": bool(self.verified),
        }
        if self.label:
            data["label"] = self.label
        if self.url:
            data["url"] = self.url
        if self.note:
            data["note"] = self.note
        if self.added_at:
            data["added_at"] = isoformat(self.added_at)
        return data

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any], *, context: str = "account") -> LinkedAccount:
        if not isinstance(raw, Mapping):
            raise ValidationError(f"{context}: phải là object JSON")

        acc_type = _clean_field(raw.get("type"), "type", MAX_ACCOUNT_TYPE_LEN, context).lower()
        handle = _clean_field(raw.get("handle"), "handle", MAX_HANDLE_LEN, context)
        visibility = str(raw.get("visibility", VISIBILITY_PUBLIC)).strip().lower()
        if visibility not in VISIBILITIES:
            raise ValidationError(
                f"{context}: visibility phải là một trong {VISIBILITIES}, nhận {visibility!r}"
            )
        url = str(raw.get("url") or "").strip()
        if url and (len(url) > MAX_URL_LEN or not _URL_RE.match(url)):
            raise ValidationError(f"{context}: url không hợp lệ (chỉ chấp nhận http/https)")
        verified = raw.get("verified", False)
        if not isinstance(verified, bool):
            raise ValidationError(f"{context}: verified phải là true/false")

        return cls(
            type=acc_type,
            handle=handle,
            label=_clean_field(raw.get("label") or "", "label", MAX_LABEL_LEN, context, required=False),
            url=url,
            visibility=visibility,
            verified=verified,
            note=_clean_field(
                raw.get("note") or "", "note", MAX_NOTE_LEN, context, required=False, single_line=False
            ),
            added_at=parse_iso(raw.get("added_at"), context=f"{context}.added_at"),
        )

    @classmethod
    def create(
        cls,
        *,
        type: str,
        handle: str,
        label: str = "",
        url: str = "",
        visibility: str = VISIBILITY_PUBLIC,
        verified: bool = False,
        note: str = "",
        added_at: datetime | None = None,
    ) -> LinkedAccount:
        """Tạo tài khoản mới với kiểm tra dữ liệu đầy đủ (dùng cho CLI/slash)."""
        raw: dict[str, Any] = {
            "type": type,
            "handle": handle,
            "label": label,
            "url": url,
            "visibility": visibility,
            "verified": verified,
            "note": note,
            "added_at": isoformat(added_at or utc_now()),
        }
        return cls.from_dict(raw, context="taikhoan")


def _clean_field(
    value: Any,
    name: str,
    max_len: int,
    context: str,
    *,
    required: bool = True,
    single_line: bool = True,
) -> str:
    """Kiểm tra độ dài trên văn bản RAW (chưa escape) và trả về bản đã làm sạch."""
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValidationError(f"{context}: {name} phải là chuỗi")
    raw = unicodedata.normalize("NFC", strip_invisible(value)).strip()
    if required and not raw:
        raise ValidationError(f"{context}: thiếu {name}")
    if len(raw) > max_len:
        raise ValidationError(f"{context}: {name} dài quá {max_len} ký tự")
    if required and "\n" in raw:
        raise ValidationError(f"{context}: {name} không được chứa xuống dòng")
    if name == "type" and not _ACCOUNT_TYPE_RE.match(raw.lower()):
        raise ValidationError(
            f"{context}: type chỉ gồm chữ thường, số và các ký tự _ . - (ví dụ: github)"
        )
    return sanitize_text(raw, max_len=max_len + 16, single_line=single_line, escape=False)


def clean_display_name(value: Any) -> str:
    """Kiểm tra + làm sạch tên hiển thị nội bộ."""
    return _clean_field(value, "display_name", MAX_DISPLAY_NAME_LEN, "nguoidung", required=False)


def clean_notes(value: Any) -> str:
    """Kiểm tra + làm sạch ghi chú nội bộ (cho phép nhiều dòng)."""
    return _clean_field(value, "notes", MAX_NOTE_LEN, "nguoidung", required=False, single_line=False)


# --------------------------------------------------------------------------- #
# Hồ sơ người dùng (dữ liệu nội bộ của bot)
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class UserProfile:
    """Dữ liệu bot lưu cho một người dùng Discord."""

    user_id: str
    display_name: str = ""
    notes: str = ""
    accounts: list[LinkedAccount] = field(default_factory=list)
    updated_at: datetime | None = None

    def visible_accounts(self, *, is_staff: bool) -> list[LinkedAccount]:
        return [a for a in self.accounts if is_staff or a.is_public()]

    def sorted_accounts(self, *, is_staff: bool) -> list[LinkedAccount]:
        accounts = self.visible_accounts(is_staff=is_staff)
        return sorted(accounts, key=lambda a: (a.type, a.handle.lower()))

    def find(self, account_type: str, handle: str) -> LinkedAccount | None:
        needle = (account_type.lower(), handle.lower())
        for acc in self.accounts:
            if acc.key() == needle:
                return acc
        return None

    def upsert(self, account: LinkedAccount) -> bool:
        """Thêm/ghi đè theo (type, handle). Trả về True nếu là bản ghi mới."""
        for idx, acc in enumerate(self.accounts):
            if acc.key() == account.key():
                self.accounts[idx] = account
                self.updated_at = utc_now()
                return False
        self.accounts.append(account)
        self.updated_at = utc_now()
        return True

    def remove(self, account_type: str, handle: str) -> bool:
        needle = (account_type.lower(), handle.lower())
        before = len(self.accounts)
        self.accounts = [a for a in self.accounts if a.key() != needle]
        if len(self.accounts) != before:
            self.updated_at = utc_now()
            return True
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "display_name": self.display_name,
            "notes": self.notes,
            "updated_at": isoformat(self.updated_at),
            "accounts": [a.to_dict() for a in self.accounts],
        }

    @classmethod
    def from_dict(cls, user_id: str, raw: Mapping[str, Any], *, context: str = "user") -> UserProfile:
        if not isinstance(raw, Mapping):
            raise ValidationError(f"{context}: phải là object JSON")
        accounts_raw = raw.get("accounts")
        if accounts_raw is None:
            accounts_raw = []
        if not isinstance(accounts_raw, list):
            raise ValidationError(f"{context}: accounts phải là mảng")
        accounts: list[LinkedAccount] = []
        seen: set[tuple[str, str]] = set()
        for idx, item in enumerate(accounts_raw):
            acc = LinkedAccount.from_dict(item, context=f"{context}.accounts[{idx}]")
            if acc.key() in seen:
                raise ValidationError(
                    f"{context}: tài khoản trùng lặp {acc.type}/{acc.handle}"
                )
            seen.add(acc.key())
            accounts.append(acc)
        return cls(
            user_id=user_id,
            display_name=_clean_field(
                raw.get("display_name") or "",
                "display_name",
                MAX_DISPLAY_NAME_LEN,
                context,
                required=False,
            ),
            notes=_clean_field(
                raw.get("notes") or "",
                "notes",
                MAX_NOTE_LEN,
                context,
                required=False,
                single_line=False,
            ),
            accounts=accounts,
            updated_at=parse_iso(raw.get("updated_at"), context=f"{context}.updated_at"),
        )


# --------------------------------------------------------------------------- #
# Ảnh chụp nhanh một người dùng Discord (do lớp bot dựng từ discord.Member)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class RoleInfo:
    name: str
    position: int
    color: int = 0
    is_default: bool = False


@dataclass(slots=True)
class UserSnapshot:
    """Dữ liệu Discord đã trích sẵn, tách khỏi đối tượng discord.py để test được."""

    user_id: int
    username: str
    display_name: str
    is_bot: bool = False
    nickname: str | None = None
    created_at: datetime | None = None
    joined_at: datetime | None = None
    guild_name: str | None = None
    roles: list[RoleInfo] = field(default_factory=list)
    boost_since: datetime | None = None
    status: str | None = None
    activities: list[str] = field(default_factory=list)
    avatar_url: str | None = None
    banner_url: str | None = None
    public_flags: list[str] = field(default_factory=list)
    accent_color: int | None = None

    def role_names(self, *, limit: int = 12) -> list[str]:
        """Tên các vai trò, sắp xếp từ cao xuống thấp (bỏ @everyone)."""
        ordered = sorted(
            (r for r in self.roles if not r.is_default),
            key=lambda r: r.position,
            reverse=True,
        )
        return [r.name for r in ordered[:limit]]

    def top_role(self) -> RoleInfo | None:
        top: RoleInfo | None = None
        for role in self.roles:
            if role.is_default:
                continue
            if top is None or role.position > top.position:
                top = role
        return top


def split_mentions(ids: Iterable[int], *, limit: int = 5) -> list[int]:
    """Lấy tối đa ``limit`` ID duy nhất theo thứ tự xuất hiện."""
    seen: list[int] = []
    for value in ids:
        if value not in seen:
            seen.append(value)
        if len(seen) >= limit:
            break
    return seen
