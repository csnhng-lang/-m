"""Test phần logic của bot không cần kết nối tới Discord (quyền, cooldown, lệnh)."""

from __future__ import annotations

import asyncio
import time
from datetime import timedelta
from types import SimpleNamespace

import discord
import pytest

import bot as botmod
from config import from_env
from models import utc_now
from store import AccountStore, StoreError

TOKEN = "x" * 70


def make_cfg(tmp_path, **env):
    base = {"DISCORD_TOKEN": TOKEN, "DATA_PATH": str(tmp_path / "accounts.json")}
    base.update(env)
    return from_env(base)


@pytest.fixture()
def bot_instance(tmp_path):
    cfg = make_cfg(tmp_path, PRESENCE_INTENT="true", PRIVACY_ROLE_ID="999")
    instance = botmod.AccountBot(cfg)
    instance.store.load()
    return instance


# --------------------------------------------------------------------------- #
# Intents / cấu hình
# --------------------------------------------------------------------------- #
def test_intents_reflect_config(tmp_path):
    cfg_off = make_cfg(tmp_path, MENTION_TRIGGER="off", PRESENCE_INTENT="false")
    b_off = botmod.AccountBot(cfg_off)
    assert b_off.intents.message_content is False
    assert b_off.intents.presences is False
    assert b_off.intents.members is True

    cfg_on = make_cfg(tmp_path, PRESENCE_INTENT="true")
    b_on = botmod.AccountBot(cfg_on)
    assert b_on.intents.message_content is True
    assert b_on.intents.presences is True


def test_allowed_mentions_never_ping(bot_instance):
    assert bot_instance.allowed_mentions.everyone is False
    assert bot_instance.allowed_mentions.users is False
    assert bot_instance.allowed_mentions.roles is False


# --------------------------------------------------------------------------- #
# Quyền xem dữ liệu nội bộ
# --------------------------------------------------------------------------- #
def _member(perms_admin=False, perms_manage_guild=False, role_ids=()):
    return SimpleNamespace(
        id=42,
        guild_permissions=SimpleNamespace(
            administrator=perms_admin, manage_guild=perms_manage_guild
        ),
        roles=[SimpleNamespace(id=rid) for rid in role_ids],
    )


def test_staff_by_administrator(bot_instance):
    guild = SimpleNamespace(get_member=lambda _id: _member(perms_admin=True))
    assert bot_instance._is_staff(SimpleNamespace(id=42), guild) is True


def test_staff_by_manage_guild(bot_instance):
    guild = SimpleNamespace(get_member=lambda _id: _member(perms_manage_guild=True))
    assert bot_instance._is_staff(SimpleNamespace(id=42), guild) is True


def test_staff_by_privacy_role(bot_instance):
    guild = SimpleNamespace(get_member=lambda _id: _member(role_ids=(999,)))
    assert bot_instance._is_staff(SimpleNamespace(id=42), guild) is True


def test_not_staff(bot_instance):
    guild = SimpleNamespace(get_member=lambda _id: _member(role_ids=(1, 2)))
    assert bot_instance._is_staff(SimpleNamespace(id=42), guild) is False


def test_staff_false_without_guild(bot_instance):
    assert bot_instance._is_staff(None, None) is False


def test_staff_disabled_privacy_role(tmp_path):
    cfg = make_cfg(tmp_path, PRIVACY_ROLE_ID="")
    b = botmod.AccountBot(cfg)
    guild = SimpleNamespace(get_member=lambda _id: _member(role_ids=(999,)))
    assert b._is_staff(SimpleNamespace(id=42), guild) is False


# --------------------------------------------------------------------------- #
# Cooldown
# --------------------------------------------------------------------------- #
def test_cooldown_blocks_repeat(bot_instance):
    assert bot_instance._cooldown_hit(1, 2) is False
    assert bot_instance._cooldown_hit(1, 2) is True
    assert bot_instance._cooldown_hit(1, 3) is False  # mục tiêu khác
    assert bot_instance._cooldown_hit(2, 2) is False  # guild khác


def test_cooldown_expires(bot_instance):
    import dataclasses

    bot_instance.cfg = dataclasses.replace(bot_instance.cfg, cooldown_seconds=0.01)
    assert bot_instance._cooldown_hit(1, 2) is False
    time.sleep(0.02)
    assert bot_instance._cooldown_hit(1, 2) is False


def test_cooldown_zero_disables(tmp_path):
    b = botmod.AccountBot(make_cfg(tmp_path, COOLDOWN_SECONDS="0"))
    assert b._cooldown_hit(1, 2) is False
    assert b._cooldown_hit(1, 2) is False


def test_cooldown_table_is_pruned(bot_instance):
    for i in range(5000):
        bot_instance._cooldowns[(1, i)] = 0.0  # đã hết hạn
    bot_instance._cooldown_hit(1, 999999)
    assert len(bot_instance._cooldowns) < 5000


# --------------------------------------------------------------------------- #
# Đăng ký lệnh
# --------------------------------------------------------------------------- #
def test_commands_registered(bot_instance):
    bot_instance._register_commands()
    names = {c.name for c in bot_instance.tree.get_commands()}
    assert {"whois", "help", "taikhoan", "Xem tài khoản"} <= names

    group = next(c for c in bot_instance.tree.get_commands() if c.name == "taikhoan")
    subs = {c.name for c in group.commands}
    assert subs == {"list", "add", "remove", "note"}


def test_admin_commands_have_permission_gate(bot_instance):
    bot_instance._register_commands()
    group = next(c for c in bot_instance.tree.get_commands() if c.name == "taikhoan")
    for sub in group.commands:
        if sub.name in {"add", "remove", "note"}:
            assert sub.checks, f"/taikhoan {sub.name} thiếu check quyền"


def test_command_payloads_are_valid(bot_instance):
    """Mọi lệnh phải tạo được payload hợp lệ cho Discord (bắt lỗi schema sớm)."""
    import json

    bot_instance._register_commands()
    payloads = [c.to_dict(bot_instance.tree) for c in bot_instance.tree.get_commands()]
    encoded = json.dumps(payloads, ensure_ascii=False)
    assert "whois" in encoded

    for payload in payloads:
        if payload.get("type") == 1:  # CHAT_INPUT
            assert payload["description"], f"/{payload['name']} thiếu description"
            assert payload.get("dm_permission") is False, (
                f"/{payload['name']} phải là guild-only (dm_permission=False)"
            )


def test_admin_group_hidden_without_permission(bot_instance):
    bot_instance._register_commands()
    group = next(c for c in bot_instance.tree.get_commands() if c.name == "taikhoan")
    payload = group.to_dict(bot_instance.tree)
    expected = discord.Permissions(manage_guild=True).value
    assert int(payload["default_member_permissions"]) == expected


def test_help_command_ephemeral(bot_instance):
    bot_instance._register_commands()
    help_cmd = next(c for c in bot_instance.tree.get_commands() if c.name == "help")
    assert help_cmd.guild_only is True


# --------------------------------------------------------------------------- #
# Dựng snapshot từ đối tượng Discord giả
# --------------------------------------------------------------------------- #
def _fake_member():
    now = utc_now()
    role = SimpleNamespace(
        name="Admin",
        position=5,
        color=SimpleNamespace(value=0x00FF00),
        is_default=lambda: False,
    )
    everyone = SimpleNamespace(
        name="@everyone",
        position=0,
        color=SimpleNamespace(value=0),
        is_default=lambda: True,
    )
    member = SimpleNamespace(
        id=42,
        name="csnhng",
        display_name="Cao Sỹ Nhân",
        bot=False,
        nick="nhan",
        created_at=now - timedelta(days=500),
        joined_at=now - timedelta(days=50),
        premium_since=None,
        status=SimpleNamespace(name="online"),
        activities=[SimpleNamespace(name="Code")],
        roles=[role, everyone],
        guild_avatar=None,
        display_avatar=SimpleNamespace(url="https://cdn.example/a.png"),
        banner=None,
        accent_color=SimpleNamespace(value=0x111111),
        public_flags=SimpleNamespace(all=lambda: [SimpleNamespace(name="active_developer")]),
    )
    guild = SimpleNamespace(
        id=7,
        name="Guild Test",
        get_member=lambda _id: member,
        fetch_member=None,
    )
    return member, guild


def test_snapshot_from_member(bot_instance):
    member, guild = _fake_member()
    snap = asyncio.run(bot_instance._snapshot(member, guild))
    assert snap.user_id == 42
    assert snap.display_name == "Cao Sỹ Nhân"
    assert snap.nickname == "nhan"
    assert snap.status == "online"
    assert snap.activities == ["Code"]
    assert snap.avatar_url.endswith("a.png")
    assert snap.top_role().name == "Admin"
    assert snap.public_flags == ["active_developer"]


def test_snapshot_without_presence_intent(tmp_path):
    b = botmod.AccountBot(make_cfg(tmp_path, PRESENCE_INTENT="false"))
    member, guild = _fake_member()
    snap = asyncio.run(b._snapshot(member, guild))
    assert snap.status is None
    assert snap.activities == []


def test_build_embed_uses_store(bot_instance, tmp_path):
    from models import LinkedAccount

    bot_instance.store.upsert_account(42, LinkedAccount.create(type="github", handle="csnhng-lang"))
    member, guild = _fake_member()
    embed = asyncio.run(
        bot_instance.build_embed(member, guild, invoker=SimpleNamespace(id=1, display_name="A"))
    )
    accounts = next(f for f in embed.fields if "liên kết" in f.name)
    assert "csnhng-lang" in accounts.value


def test_store_error_on_bad_file(tmp_path):
    path = tmp_path / "accounts.json"
    path.write_text("{bad", encoding="utf-8")
    store = AccountStore(path)
    with pytest.raises(StoreError):
        store.load()


# --------------------------------------------------------------------------- #
# Nhận diện tiền tố lệnh
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("!info @user", True),
        ("!info", True),
        ("!info\n<@123>", True),
        ("!info <@!123>", True),
        ("!information @user", False),
        ("!infooo", False),
        ("hello !info @user", False),
        ("", False),
    ],
)
def test_prefix_matching(content, expected):
    assert botmod._matches_prefix(content, "!info") is expected
