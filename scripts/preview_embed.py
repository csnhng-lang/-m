#!/usr/bin/env python3
"""Dựng trước (preview) embed mà bot sẽ gửi, không cần token hay kết nối Discord.

    python scripts/preview_embed.py                  # in JSON embed ra terminal
    python scripts/preview_embed.py --html docs/preview.html

Mục đích: xem trước nội dung/kích thước embed và kiểm tra giới hạn 6000 ký tự
của Discord trước khi chạy bot thật.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import discord  # noqa: E402

import embeds  # noqa: E402
from github_api import GitHubProfile  # noqa: E402
from models import (  # noqa: E402
    LinkedAccount,
    RoleInfo,
    UserProfile,
    UserSnapshot,
    human_delta,
    utc_now,
)

DEMO_USER_ID = 123456789012345678


def demo_snapshot() -> UserSnapshot:
    now = utc_now()
    return UserSnapshot(
        user_id=DEMO_USER_ID,
        username="csnhng",
        display_name="Cao Sỹ Nhân",
        nickname="nhan",
        is_bot=False,
        created_at=now - timedelta(days=1180),
        joined_at=now - timedelta(days=210),
        guild_name="Server Demo",
        roles=[
            RoleInfo(name="@everyone", position=0, is_default=True),
            RoleInfo(name="Admin", position=9, color=0xE67E22),
            RoleInfo(name="Developer", position=6, color=0x3498DB),
            RoleInfo(name="Member", position=2, color=0x95A5A6),
        ],
        boost_since=now - timedelta(days=45),
        status="online",
        activities=["Visual Studio Code", "Đang code bot Discord"],
        avatar_url="https://cdn.discordapp.com/embed/avatars/0.png",
        banner_url=None,
        public_flags=["active_developer", "early_supporter"],
        accent_color=0xE67E22,
    )


def demo_profile() -> UserProfile:
    profile = UserProfile(
        user_id=str(DEMO_USER_ID),
        display_name="Nhân (dev chính)",
        notes="Đã xác minh danh tính qua video call. Ưu tiên liên hệ qua Discord.",
    )
    now = utc_now()
    profile.upsert(
        LinkedAccount.create(
            type="github",
            handle="csnhng-lang",
            label="GitHub chính",
            url="https://github.com/csnhng-lang",
            visibility="public",
            verified=True,
            added_at=now - timedelta(days=120),
        )
    )
    profile.upsert(
        LinkedAccount.create(
            type="steam",
            handle="nhan_gaming",
            label="Steam",
            url="https://steamcommunity.com/id/nhan_gaming",
            visibility="public",
            added_at=now - timedelta(days=30),
        )
    )
    profile.upsert(
        LinkedAccount.create(
            type="riot",
            handle="Nhan#VN1",
            label="Riot (LMHT)",
            visibility="restricted",
            note="Chỉ dùng khi xử lý tranh chấp",
            added_at=now - timedelta(days=10),
        )
    )
    profile.upsert(
        LinkedAccount.create(
            type="email",
            handle="nhan@example.com",
            visibility="restricted",
            verified=True,
            added_at=now - timedelta(days=10),
        )
    )
    return profile


def demo_github() -> GitHubProfile:
    now = utc_now()
    return GitHubProfile(
        login="csnhng-lang",
        html_url="https://github.com/csnhng-lang",
        name="Cao Sy Nhan",
        bio="Backend dev · thích bot Discord",
        location="Bắc Ninh, Việt Nam",
        public_repos=14,
        followers=37,
        following=12,
        created_at=now - timedelta(days=1500),
        updated_at=now - timedelta(days=2),
    )


# --------------------------------------------------------------------------- #
# Render HTML (tự chứa, không tải tài nguyên ngoài — xem được trong iframe sandbox)
# --------------------------------------------------------------------------- #
_TOKEN = "\x00"
_TIMESTAMP_RE = re.compile(r"<t:(\d+):([fFR])>")


def readable_timestamps(text: str) -> str:
    """Đổi cú pháp <t:...> của Discord thành ngày giờ đọc được (chỉ để xem trước)."""
    def repl(match: re.Match[str]) -> str:
        moment = datetime.fromtimestamp(int(match.group(1)), tz=UTC)
        if match.group(2) == "R":
            return f"{human_delta(moment)} trước"
        return moment.strftime("%d/%m/%Y %H:%M UTC")

    return _TIMESTAMP_RE.sub(repl, text)


def md_to_html(text: str) -> str:
    """Chuyển markdown rút gọn của Discord sang HTML, an toàn với HTML injection."""
    escaped = html.escape(readable_timestamps(text))
    # Giữ nguyên các ký tự đã escape bằng backslash, không biến đổi tiếp.
    escaped = re.sub(r"\\([\\*_~|`>\[\]()<@#&])", lambda m: _TOKEN + m.group(1), escaped)
    escaped = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{m.group(2)}" target="_blank" rel="noopener">{m.group(1)}</a>',
        escaped,
    )
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"__(.+?)__", r"<u>\1</u>", escaped)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", escaped)
    escaped = re.sub(r"(?<![\w_])_([^_\n]+)_(?![\w_])", r"<em>\1</em>", escaped)
    return escaped.replace(_TOKEN, "")


def render_embed(embed: discord.Embed, *, label: str) -> str:
    data = embed.to_dict()
    colour = f"#{embed.colour.value:06x}" if embed.colour else "#4f545c"
    parts: list[str] = [
        f'<div class="embed" style="border-left:4px solid {colour}">',
        f'<div class="label">{html.escape(label)} · {len(embed)} ký tự</div>',
    ]
    if embed.title:
        parts.append(f'<div class="title">{md_to_html(embed.title)}</div>')
    if embed.description:
        parts.append(f'<div class="desc">{md_to_html(embed.description)}</div>')
    for field in data.get("fields", []):
        parts.append(
            '<div class="field">'
            f'<div class="fname">{md_to_html(field["name"])}</div>'
            f'<div class="fvalue">{md_to_html(field["value"])}</div>'
            "</div>"
        )
    if embed.footer and embed.footer.text:
        parts.append(f'<div class="footer">{md_to_html(embed.footer.text)}</div>')
    parts.append("</div>")
    return "\n".join(parts)


HTML_TEMPLATE = """<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview embed — bot giới thiệu tài khoản</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 28px 18px 56px;
    background: #313338; color: #dbdee1;
    font-family: "gg sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px; line-height: 1.45;
  }}
  .wrap {{ max-width: 760px; margin: 0 auto; }}
  h1 {{ font-size: 20px; color: #f2f3f5; margin: 0 0 4px; }}
  .sub {{ color: #949ba4; font-size: 13px; margin-bottom: 22px; }}
  .msg {{ display: flex; gap: 14px; margin-bottom: 26px; }}
  .avatar {{
    width: 40px; height: 40px; border-radius: 50%; flex: 0 0 40px;
    background: #5865f2; color: #fff; display: flex; align-items: center;
    justify-content: center; font-weight: 700; font-size: 16px;
  }}
  .body {{ min-width: 0; }}
  .author {{ font-weight: 600; color: #f2f3f5; }}
  .author .bot {{
    background: #5865f2; color: #fff; font-size: 10px; padding: 1px 4px;
    border-radius: 3px; margin-left: 6px; vertical-align: 2px; text-transform: uppercase;
  }}
  .embed {{
    margin-top: 6px; background: #2b2d31; border-radius: 4px; padding: 14px 16px;
    max-width: 100%; overflow-wrap: anywhere;
  }}
  .label {{
    font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: #949ba4; margin-bottom: 10px;
  }}
  .title {{ font-size: 16px; font-weight: 600; color: #f2f3f5; margin-bottom: 8px; }}
  .desc {{ font-size: 14px; margin-bottom: 8px; }}
  .field {{ margin-top: 12px; }}
  .fname {{ font-size: 14px; font-weight: 600; color: #f2f3f5; margin-bottom: 3px; }}
  .fvalue {{ font-size: 14px; white-space: pre-wrap; }}
  .footer {{ margin-top: 14px; font-size: 12px; color: #949ba4; }}
  code {{
    background: #1e1f22; border-radius: 3px; padding: 1px 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
  }}
  a {{ color: #00a8fc; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .note {{
    color: #949ba4; font-size: 13px; border-left: 3px solid #4e5058;
    padding: 8px 12px; margin: 0 0 26px; background: #2b2d31; border-radius: 4px;
  }}
</style>
</head>
<body>
<div class="wrap">
  <h1>Bot giới thiệu tài khoản — xem trước output</h1>
  <div class="sub">Ảnh chụp tĩnh dựng trực tiếp từ <code>embeds.build_profile_embed()</code> — đúng dữ liệu bot sẽ gửi.</div>
  <div class="note">
    Panel 1: người bình thường mention nhau trong kênh.<br>
    Panel 2: quản trị viên xem bằng <code>/whois</code> với <code>rieng_tu:true</code> — thấy thêm ghi chú và tài khoản <em>restricted</em>.
  </div>
  <div class="msg">
    <div class="avatar">D</div>
    <div class="body">
      <div class="author">Bot giới thiệu tài khoản<span class="bot">bot</span></div>
      {public_embed}
    </div>
  </div>
  <div class="msg">
    <div class="avatar">D</div>
    <div class="body">
      <div class="author">Bot giới thiệu tài khoản<span class="bot">bot</span></div>
      {staff_embed}
    </div>
  </div>
</div>
</body>
</html>
"""


def build_embeds() -> tuple[discord.Embed, discord.Embed]:
    snapshot = demo_snapshot()
    profile = demo_profile()
    gh = demo_github()
    public = embeds.build_profile_embed(
        snapshot,
        profile,
        is_staff=False,
        github_profiles={gh.login: gh},
        requested_by="Minh Anh",
        show_private=False,
    )
    staff = embeds.build_profile_embed(
        snapshot,
        profile,
        is_staff=True,
        github_profiles={gh.login: gh},
        requested_by="Admin",
        show_private=True,
    )
    return public, staff


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Preview embed của bot")
    parser.add_argument("--html", type=Path, help="ghi file HTML xem trước")
    parser.add_argument("--json", action="store_true", help="in JSON embed (định dạng Discord)")
    args = parser.parse_args(argv)

    public, staff = build_embeds()

    if args.json:
        print(json.dumps({"public": public.to_dict(), "staff": staff.to_dict()}, ensure_ascii=False, indent=2))
        return 0

    if args.html:
        args.html.parent.mkdir(parents=True, exist_ok=True)
        args.html.write_text(
            HTML_TEMPLATE.format(
                public_embed=render_embed(public, label="Người thường xem"),
                staff_embed=render_embed(staff, label="Staff xem (ephemeral)"),
            ),
            encoding="utf-8",
        )
        print(f"Đã ghi {args.html} ({args.html.stat().st_size} bytes)")
        print(f"Độ dài embed: public={len(public)} ký tự, staff={len(staff)} ký tự (giới hạn 6000)")
        return 0

    print(public)
    print()
    print(staff)
    print(f"\nĐộ dài: public={len(public)}, staff={len(staff)} (giới hạn Discord: 6000)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
