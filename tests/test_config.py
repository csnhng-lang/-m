"""Test cho việc nạp cấu hình."""

from __future__ import annotations

import pytest

from config import ConfigError, from_env, load_dotenv

VALID = {"DISCORD_TOKEN": "a" * 70}


def test_minimal_config():
    cfg = from_env(VALID)
    assert cfg.guild_id is None
    assert cfg.mention_trigger == "bot"
    assert cfg.cooldown_seconds == 8.0
    assert cfg.github_enrich is False


def test_missing_token():
    with pytest.raises(ConfigError) as excinfo:
        from_env({})
    assert "DISCORD_TOKEN" in str(excinfo.value)


def test_token_not_required_when_disabled():
    assert from_env({}, require_token=False).token == ""


@pytest.mark.parametrize("value", ["true", "1", "yes", "ON"])
def test_bool_true(value):
    assert from_env({**VALID, "EPHEMERAL": value}).ephemeral is True


@pytest.mark.parametrize("value", ["false", "0", "no", "OFF"])
def test_bool_false(value):
    assert from_env({**VALID, "EPHEMERAL": value}).ephemeral is False


def test_bad_bool():
    with pytest.raises(ConfigError):
        from_env({**VALID, "EPHEMERAL": "maybe"})


def test_empty_guild_id_means_unset():
    assert from_env({**VALID, "GUILD_ID": ""}).guild_id is None


@pytest.mark.parametrize("value", ["0", "-5", "abc"])
def test_bad_guild_id(value):
    with pytest.raises(ConfigError):
        from_env({**VALID, "GUILD_ID": value})


def test_bad_mention_trigger():
    with pytest.raises(ConfigError):
        from_env({**VALID, "MENTION_TRIGGER": "everything"})


def test_bad_prefix():
    with pytest.raises(ConfigError):
        from_env({**VALID, "COMMAND_PREFIX": "hai tu"})


def test_negative_cooldown():
    with pytest.raises(ConfigError):
        from_env({**VALID, "COOLDOWN_SECONDS": "-1"})


def test_redacted_hides_secrets():
    cfg = from_env({**VALID, "GITHUB_TOKEN": "github_pat_1234567890abcdef"})
    redacted = cfg.redacted()
    assert "1234567890" not in str(redacted["token"])
    assert str(redacted["github_token"]).startswith("***")
    assert "a" * 70 not in str(redacted)


def test_dotenv_parsing(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment\n"
        "\n"
        "DISCORD_TOKEN='abc'\n"
        'GUILD_ID="123"\n'
        "export LOG_LEVEL=DEBUG\n"
        "DISCORD_TOKEN=ghi-de\n",
        encoding="utf-8",
    )
    env: dict[str, str] = {}
    loaded = load_dotenv(env_file, environ=env)
    assert env["DISCORD_TOKEN"] == "abc"  # không ghi đè
    assert env["GUILD_ID"] == "123"
    assert env["LOG_LEVEL"] == "DEBUG"
    assert set(loaded) == {"DISCORD_TOKEN", "GUILD_ID", "LOG_LEVEL"}


def test_dotenv_missing_file(tmp_path):
    assert load_dotenv(tmp_path / "khong-ton-tai.env", environ={}) == []
