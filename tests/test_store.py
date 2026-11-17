"""Test cho kho dữ liệu JSON."""

from __future__ import annotations

import json

import pytest

from models import LinkedAccount
from store import STORE_VERSION, AccountStore, StoreError


@pytest.fixture()
def store(tmp_path) -> AccountStore:
    s = AccountStore(tmp_path / "data" / "accounts.json")
    s.load()
    return s


def test_creates_file_when_missing(store: AccountStore, tmp_path):
    assert (tmp_path / "data" / "accounts.json").is_file()
    assert len(store) == 0
    doc = json.loads((tmp_path / "data" / "accounts.json").read_text())
    assert doc["version"] == STORE_VERSION
    assert doc["users"] == {}


def test_add_and_persist(store: AccountStore, tmp_path):
    acc = LinkedAccount.create(type="github", handle="csnhng-lang", label="GitHub")
    assert store.upsert_account(123, acc) is True
    assert store.upsert_account(123, acc) is False  # cập nhật, không nhân bản

    reloaded = AccountStore(tmp_path / "data" / "accounts.json")
    reloaded.load()
    profile = reloaded.get(123)
    assert profile is not None
    assert len(profile.accounts) == 1
    assert profile.accounts[0].handle == "csnhng-lang"


def test_no_temp_files_left(store: AccountStore, tmp_path):
    store.upsert_account(1, LinkedAccount.create(type="steam", handle="x"))
    leftovers = [p.name for p in (tmp_path / "data").iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []


def test_remove_account_cleans_empty_profile(store: AccountStore):
    store.upsert_account(1, LinkedAccount.create(type="steam", handle="x"))
    assert store.remove_account(1, "steam", "x") is True
    assert store.get(1) is None
    assert len(store) == 0


def test_remove_missing_returns_false(store: AccountStore):
    assert store.remove_account(1, "steam", "x") is False


def test_set_notes_and_display_name(store: AccountStore):
    store.set_notes(7, "ghi chú\nnhiều dòng")
    store.set_display_name(7, "Tên nội bộ")
    profile = store.get(7)
    assert profile is not None
    assert profile.notes == "ghi chú\nnhiều dòng"
    assert profile.display_name == "Tên nội bộ"


def test_notes_too_long_rejected(store: AccountStore):
    from models import ValidationError

    with pytest.raises(ValidationError):
        store.set_notes(7, "x" * 501)


def test_invalid_json_is_not_overwritten(tmp_path):
    path = tmp_path / "accounts.json"
    path.write_text("{ hỏng json", encoding="utf-8")
    store = AccountStore(path)
    with pytest.raises(StoreError) as excinfo:
        store.load()
    assert "JSON" in str(excinfo.value)
    assert path.read_text(encoding="utf-8") == "{ hỏng json"


def test_unsupported_version(tmp_path):
    path = tmp_path / "accounts.json"
    path.write_text(json.dumps({"version": 99, "users": {}}), encoding="utf-8")
    with pytest.raises(StoreError):
        AccountStore(path).load()


@pytest.mark.parametrize(
    "payload",
    [
        {"version": 1, "users": []},
        {"version": 1, "users": {"abc": {}}},
        {"version": 1, "users": {"1": {"accounts": "x"}}},
        {"version": 1, "users": {"1": {"accounts": [{"type": "github"}]}}},
    ],
)
def test_bad_schema_raises_with_context(tmp_path, payload):
    path = tmp_path / "accounts.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(StoreError):
        AccountStore(path).load()


def test_empty_file_is_treated_as_empty_store(tmp_path):
    path = tmp_path / "accounts.json"
    path.write_text("   \n", encoding="utf-8")
    store = AccountStore(path)
    store.load()
    assert len(store) == 0


def test_utf8_preserved_on_disk(store: AccountStore, tmp_path):
    store.set_notes(1, "Nguyễn Văn Ánh — 日本語")
    raw = (tmp_path / "data" / "accounts.json").read_text(encoding="utf-8")
    assert "Nguyễn Văn Ánh" in raw
