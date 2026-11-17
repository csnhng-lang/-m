#!/usr/bin/env python3
"""CLI quản lý kho tài khoản — dùng khi không muốn thao tác qua Discord.

Ví dụ:
    python scripts/manage.py list
    python scripts/manage.py show 123456789012345678
    python scripts/manage.py add --user 123456789012345678 --type github \
        --handle csnhng-lang --label "GitHub chính" --url https://github.com/csnhng-lang
    python scripts/manage.py remove --user 123456789012345678 --type github --handle csnhng-lang
    python scripts/manage.py note --user 123456789012345678 --text "Khách hàng VIP"
    python scripts/manage.py validate
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import DEFAULT_DATA_PATH, load_dotenv  # noqa: E402
from models import LinkedAccount, ValidationError  # noqa: E402
from store import AccountStore, StoreError  # noqa: E402


def _store(args: argparse.Namespace, *, create: bool | None = None) -> AccountStore:
    """Mở kho dữ liệu. ``create`` mặc định lấy từ cờ --create của lệnh đang chạy."""
    path = Path(getattr(args, "data", None) or os.environ.get("DATA_PATH") or DEFAULT_DATA_PATH)
    store = AccountStore(path)
    if create is None:
        create = bool(getattr(args, "create", False))
    store.load(create_if_missing=create)
    return store


def _print_profile(user_id: str, store: AccountStore) -> None:
    profile = store.get(user_id)
    if profile is None:
        print(f"• {user_id}: (chưa có dữ liệu)")
        return
    print(f"• {user_id}" + (f" — {profile.display_name}" if profile.display_name else ""))
    if profile.notes:
        print(f"  ghi chú: {profile.notes}")
    if not profile.accounts:
        print("  (không có tài khoản liên kết)")
    for acc in profile.sorted_accounts(is_staff=True):
        flags = []
        if acc.verified:
            flags.append("verified")
        if not acc.is_public():
            flags.append("restricted")
        extra = f" [{', '.join(flags)}]" if flags else ""
        label = f" ({acc.label})" if acc.label else ""
        print(f"  - {acc.type}/{acc.handle}{label}{extra}")
        if acc.url:
            print(f"    {acc.url}")


def cmd_list(args: argparse.Namespace) -> int:
    store = _store(args)
    users = store.users
    if not users:
        print(f"Kho dữ liệu trống: {store.path}")
        return 0
    print(f"{len(users)} hồ sơ trong {store.path}:")
    for user_id in sorted(users):
        _print_profile(user_id, store)
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    store = _store(args)
    if store.get(args.user) is None:
        print(f"Không có dữ liệu cho {args.user}", file=sys.stderr)
        return 1
    _print_profile(args.user, store)
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    if not args.user.isdigit():
        print("--user phải là ID Discord (chỉ gồm chữ số)", file=sys.stderr)
        return 2
    store = _store(args, create=True)
    try:
        account = LinkedAccount.create(
            type=args.type,
            handle=args.handle,
            label=args.label or "",
            url=args.url or "",
            visibility=args.visibility,
            verified=args.verified,
            note=args.note or "",
        )
    except ValidationError as exc:
        print(f"Lỗi dữ liệu: {exc}", file=sys.stderr)
        return 2
    is_new = store.upsert_account(args.user, account)
    print(f"{'Đã thêm' if is_new else 'Đã cập nhật'} {account.type}/{account.handle} cho {args.user}")
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    store = _store(args)
    if not store.remove_account(args.user, args.type, args.handle):
        print(f"Không tìm thấy {args.type}/{args.handle} của {args.user}", file=sys.stderr)
        return 1
    print(f"Đã xoá {args.type}/{args.handle} của {args.user}")
    return 0


def cmd_note(args: argparse.Namespace) -> int:
    store = _store(args, create=True)
    try:
        store.set_notes(args.user, args.text)
    except ValidationError as exc:
        print(f"Lỗi dữ liệu: {exc}", file=sys.stderr)
        return 2
    print(f"Đã cập nhật ghi chú cho {args.user}")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    try:
        store = _store(args)
    except StoreError as exc:
        print(f"KHÔNG HỢP LỆ: {exc}", file=sys.stderr)
        return 1
    total_accounts = sum(len(p.accounts) for p in store.users.values())
    print(f"Hợp lệ: {len(store)} hồ sơ, {total_accounts} tài khoản — {store.path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Quản lý kho tài khoản của bot Discord")
    parser.add_argument(
        "--data",
        default=argparse.SUPPRESS,
        help=f"đường dẫn file dữ liệu (mặc định: $DATA_PATH hoặc {DEFAULT_DATA_PATH})",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def add_data_option(subparser: argparse.ArgumentParser) -> None:
        """Cho phép đặt --data sau lệnh con: `manage.py list --data x.json`."""
        subparser.add_argument(
            "--data",
            default=argparse.SUPPRESS,
            help="đường dẫn file dữ liệu (đặt trước hoặc sau lệnh đều được)",
        )

    p_list = sub.add_parser("list", help="liệt kê toàn bộ hồ sơ")
    p_list.add_argument("--create", action="store_true", help="tạo file nếu chưa có (rỗng)")
    add_data_option(p_list)
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="xem một hồ sơ")
    p_show.add_argument("user", help="ID Discord")
    add_data_option(p_show)
    p_show.set_defaults(func=cmd_show)

    p_add = sub.add_parser("add", help="thêm/cập nhật tài khoản")
    p_add.add_argument("--user", required=True, help="ID Discord")
    p_add.add_argument("--type", required=True, help="loại tài khoản (github, steam, ...)")
    p_add.add_argument("--handle", required=True, help="tên đăng nhập / ID")
    p_add.add_argument("--label", help="nhãn hiển thị")
    p_add.add_argument("--url", help="link hồ sơ (http/https)")
    p_add.add_argument(
        "--visibility", choices=("public", "restricted"), default="public", help="ai được thấy"
    )
    p_add.add_argument("--verified", action="store_true", help="đánh dấu đã xác minh")
    p_add.add_argument("--note", help="ghi chú ngắn")
    add_data_option(p_add)
    p_add.set_defaults(func=cmd_add)

    p_rm = sub.add_parser("remove", help="xoá tài khoản")
    p_rm.add_argument("--user", required=True)
    p_rm.add_argument("--type", required=True)
    p_rm.add_argument("--handle", required=True)
    add_data_option(p_rm)
    p_rm.set_defaults(func=cmd_remove)

    p_note = sub.add_parser("note", help="đặt ghi chú nội bộ")
    p_note.add_argument("--user", required=True)
    p_note.add_argument("--text", default="", help="nội dung (rỗng để xoá)")
    add_data_option(p_note)
    p_note.set_defaults(func=cmd_note)

    p_val = sub.add_parser("validate", help="kiểm tra file dữ liệu")
    add_data_option(p_val)
    p_val.set_defaults(func=cmd_validate)
    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except StoreError as exc:
        print(f"Lỗi dữ liệu: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
