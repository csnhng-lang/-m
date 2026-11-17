"""Test CLI quản lý dữ liệu (scripts/manage.py) — chạy trực tiếp qua main(argv)."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("manage_cli", ROOT / "scripts" / "manage.py")
manage = importlib.util.module_from_spec(spec)
sys.modules["manage_cli"] = manage
spec.loader.exec_module(manage)


@pytest.fixture()
def data_file(tmp_path) -> Path:
    return tmp_path / "accounts.json"


def test_add_then_list(data_file, capsys):
    assert manage.main(["--data", str(data_file), "add", "--user", "42", "--type", "github",
                        "--handle", "csnhng-lang"]) == 0
    out = capsys.readouterr().out
    assert "Đã thêm github/csnhng-lang" in out

    assert manage.main(["--data", str(data_file), "list"]) == 0
    out = capsys.readouterr().out
    assert "github/csnhng-lang" in out


def test_data_option_after_subcommand(data_file, capsys):
    """--data đặt sau lệnh con cũng phải hoạt động."""
    assert manage.main(["add", "--user", "42", "--type", "steam", "--handle", "gaben",
                        "--data", str(data_file)]) == 0
    assert manage.main(["show", "42", "--data", str(data_file)]) == 0
    assert "steam/gaben" in capsys.readouterr().out


def test_invalid_type_rejected(data_file, capsys):
    assert manage.main(["--data", str(data_file), "add", "--user", "42",
                        "--type", "GIT HUB", "--handle", "x"]) == 2
    assert "Lỗi dữ liệu" in capsys.readouterr().err


def test_invalid_url_rejected(data_file, capsys):
    assert manage.main(["--data", str(data_file), "add", "--user", "42", "--type", "github",
                        "--handle", "x", "--url", "javascript:alert(1)"]) == 2
    assert "url" in capsys.readouterr().err


def test_non_numeric_user_rejected(data_file, capsys):
    assert manage.main(["--data", str(data_file), "add", "--user", "abc",
                        "--type", "github", "--handle", "x"]) == 2
    assert "ID Discord" in capsys.readouterr().err


def test_remove_missing_returns_one(data_file, capsys):
    assert manage.main(["--data", str(data_file), "remove", "--user", "42",
                        "--type", "github", "--handle", "khong-co"]) == 1
    assert "Không tìm thấy" in capsys.readouterr().err


def test_note_and_validate(data_file, capsys):
    assert manage.main(["--data", str(data_file), "note", "--user", "42",
                        "--text", "Khách VIP"]) == 0
    assert manage.main(["--data", str(data_file), "validate"]) == 0
    assert "Hợp lệ: 1 hồ sơ" in capsys.readouterr().out


def test_show_missing_returns_one(data_file, capsys):
    manage.main(["--data", str(data_file), "add", "--user", "42", "--type", "github",
                 "--handle", "a"])
    capsys.readouterr()
    assert manage.main(["--data", str(data_file), "show", "999"]) == 1
    assert "Không có dữ liệu" in capsys.readouterr().err


def test_show_without_data_file_reports_clearly(tmp_path, capsys):
    assert manage.main(["--data", str(tmp_path / "chua-co.json"), "show", "42"]) == 1
    assert "Không tìm thấy file dữ liệu" in capsys.readouterr().err


def test_corrupt_file_reported(tmp_path, capsys):
    path = tmp_path / "broken.json"
    path.write_text("{bad", encoding="utf-8")
    assert manage.main(["--data", str(path), "list"]) == 1
    assert "Lỗi dữ liệu" in capsys.readouterr().err


def test_file_stays_valid_json_after_edits(data_file, capsys):
    manage.main(["--data", str(data_file), "add", "--user", "42", "--type", "github",
                 "--handle", "a"])
    manage.main(["--data", str(data_file), "add", "--user", "42", "--type", "steam",
                 "--handle", "b", "--visibility", "restricted"])
    document = json.loads(data_file.read_text(encoding="utf-8"))
    assert document["version"] == 1
    assert len(document["users"]["42"]["accounts"]) == 2
