"""Kho dữ liệu JSON cho hồ sơ tài khoản.

Thiết kế:
- Toàn bộ file được giữ trong bộ nhớ, mọi thay đổi đi qua API có kiểm tra.
- Ghi atomic (tmp + fsync + os.replace) để không bao giờ để lại file hỏng.
- File hỏng/không hợp lệ -> ném ``StoreError`` kèm vị trí lỗi, KHÔNG tự ghi đè.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from models import (
    LinkedAccount,
    UserProfile,
    ValidationError,
    clean_display_name,
    clean_notes,
    isoformat,
    utc_now,
)

STORE_VERSION = 1


class StoreError(RuntimeError):
    """File dữ liệu không đọc được hoặc sai cấu trúc."""


def empty_document() -> dict[str, Any]:
    return {"version": STORE_VERSION, "updated_at": isoformat(utc_now()), "users": {}}


class AccountStore:
    """Đọc/ghi ``data/accounts.json``."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._users: dict[str, UserProfile] = {}
        self._loaded = False

    # ------------------------------------------------------------------ #
    # Nạp / lưu
    # ------------------------------------------------------------------ #
    def load(self, *, create_if_missing: bool = True) -> None:
        if not self.path.exists():
            if not create_if_missing:
                raise StoreError(f"Không tìm thấy file dữ liệu: {self.path}")
            self._users = {}
            self._loaded = True
            self.save()
            return

        try:
            raw_text = self.path.read_text(encoding="utf-8")
        except OSError as exc:
            raise StoreError(f"Không đọc được {self.path}: {exc}") from exc

        if not raw_text.strip():
            self._users = {}
            self._loaded = True
            return

        try:
            document = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise StoreError(
                f"{self.path} không phải JSON hợp lệ (dòng {exc.lineno}, cột {exc.colno}): {exc.msg}. "
                "Sửa tay hoặc khôi phục từ git; bot sẽ không ghi đè dữ liệu của bạn."
            ) from exc

        if not isinstance(document, Mapping):
            raise StoreError(f"{self.path}: nội dung gốc phải là object JSON")

        version = document.get("version", STORE_VERSION)
        if not isinstance(version, int) or version > STORE_VERSION:
            raise StoreError(
                f"{self.path}: version {version!r} không được hỗ trợ (bot hiểu version <= {STORE_VERSION})"
            )

        users_raw = document.get("users")
        if users_raw is None:
            users_raw = {}
        if not isinstance(users_raw, Mapping):
            raise StoreError(f"{self.path}: 'users' phải là object JSON (key = ID Discord)")

        users: dict[str, UserProfile] = {}
        for discord_id, payload in users_raw.items():
            key = str(discord_id).strip()
            if not key.isdigit():
                raise StoreError(f"{self.path}: khóa {discord_id!r} không phải ID Discord hợp lệ")
            try:
                users[key] = UserProfile.from_dict(key, payload, context=f"users[{key}]")
            except ValidationError as exc:
                raise StoreError(f"{self.path}: {exc}") from exc

        self._users = users
        self._loaded = True

    def reload(self) -> None:
        self.load(create_if_missing=False)

    def save(self) -> None:
        document = {
            "version": STORE_VERSION,
            "updated_at": isoformat(utc_now()),
            "users": {uid: profile.to_dict() for uid, profile in sorted(self._users.items())},
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(document, ensure_ascii=False, indent=2) + "\n"

        tmp_path: Path | None = None
        try:
            fd, raw_tmp = tempfile.mkstemp(
                dir=str(self.path.parent), prefix=f".{self.path.name}.", suffix=".tmp"
            )
            tmp_path = Path(raw_tmp)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            tmp_path.replace(self.path)  # atomic trên cùng filesystem
            tmp_path = None
        except OSError as exc:
            raise StoreError(f"Không ghi được {self.path}: {exc}") from exc
        finally:
            if tmp_path is not None and tmp_path.exists():
                tmp_path.unlink()

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    # ------------------------------------------------------------------ #
    # Truy vấn
    # ------------------------------------------------------------------ #
    @property
    def users(self) -> Mapping[str, UserProfile]:
        self._ensure_loaded()
        return dict(self._users)

    def __len__(self) -> int:
        self._ensure_loaded()
        return len(self._users)

    def get(self, user_id: int | str) -> UserProfile | None:
        self._ensure_loaded()
        return self._users.get(str(user_id))

    def get_or_create(self, user_id: int | str) -> UserProfile:
        self._ensure_loaded()
        key = str(user_id)
        profile = self._users.get(key)
        if profile is None:
            profile = UserProfile(user_id=key, updated_at=utc_now())
            self._users[key] = profile
        return profile

    # ------------------------------------------------------------------ #
    # Thay đổi
    # ------------------------------------------------------------------ #
    def upsert_account(self, user_id: int | str, account: LinkedAccount) -> bool:
        """Thêm/ghi đè tài khoản. Trả về True nếu là bản ghi mới."""
        profile = self.get_or_create(user_id)
        is_new = profile.upsert(account)
        self.save()
        return is_new

    def remove_account(self, user_id: int | str, account_type: str, handle: str) -> bool:
        profile = self.get(user_id)
        if profile is None:
            return False
        if not profile.remove(account_type, handle):
            return False
        if not profile.accounts and not profile.display_name and not profile.notes:
            self._users.pop(str(user_id), None)
        self.save()
        return True

    def set_display_name(self, user_id: int | str, display_name: str) -> None:
        profile = self.get_or_create(user_id)
        profile.display_name = clean_display_name(display_name)
        profile.updated_at = utc_now()
        self.save()

    def set_notes(self, user_id: int | str, notes: str) -> None:
        profile = self.get_or_create(user_id)
        profile.notes = clean_notes(notes)
        profile.updated_at = utc_now()
        self.save()
