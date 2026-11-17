"""Nạp cấu hình từ biến môi trường (kèm đọc file .env, không cần dependency ngoài)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_DATA_PATH = Path("data/accounts.json")
MENTION_TRIGGERS = ("bot", "any", "off")
LOG_LEVELS = ("CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG")


class ConfigError(RuntimeError):
    """Cấu hình thiếu hoặc sai."""


def load_dotenv(path: Path | str = Path(".env"), *, environ: Mapping[str, str] | None = None) -> list[str]:
    """Nạp file .env vào os.environ (không ghi đè biến đã tồn tại).

    Trả về danh sách tên biến đã nạp. Bỏ qua dòng trống và dòng bắt đầu bằng #.
    """
    env = os.environ if environ is None else environ
    dotenv_path = Path(path)
    loaded: list[str] = []
    if not dotenv_path.is_file():
        return loaded
    try:
        text = dotenv_path.read_text(encoding="utf-8")
    except OSError:
        return loaded
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export ") :].strip()
        if not key or not key.replace("_", "").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key not in env:
            env[key] = value  # type: ignore[index]
            loaded.append(key)
    return loaded


def _get_bool(env: Mapping[str, str], key: str, default: bool) -> bool:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "y", "on"}:
        return True
    if value in {"0", "false", "no", "n", "off"}:
        return False
    raise ConfigError(f"{key} phải là true/false, nhận {raw!r}")


def _get_int(env: Mapping[str, str], key: str, default: int | None, *, minimum: int = 1) -> int | None:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise ConfigError(f"{key} phải là số nguyên, nhận {raw!r}") from exc
    if value < minimum:
        raise ConfigError(f"{key} phải >= {minimum}, nhận {value}")
    return value


def _get_float(env: Mapping[str, str], key: str, default: float, *, minimum: float = 0.0) -> float:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw.strip())
    except ValueError as exc:
        raise ConfigError(f"{key} phải là số, nhận {raw!r}") from exc
    if value < minimum:
        raise ConfigError(f"{key} phải >= {minimum}, nhận {value}")
    return value


@dataclass(frozen=True, slots=True)
class Config:
    token: str
    guild_id: int | None = None
    mention_trigger: str = "bot"
    command_prefix: str = "!info"
    ephemeral: bool = False
    cooldown_seconds: float = 8.0
    privacy_role_id: int | None = None
    github_token: str | None = None
    github_enrich: bool = False
    data_path: Path = DEFAULT_DATA_PATH
    log_level: str = "INFO"
    presence_intent: bool = False
    _loaded_env: tuple[str, ...] = field(default=(), repr=False)

    def redacted(self) -> dict[str, object]:
        """Bản cấu hình an toàn để log (đã che token)."""
        def mask(value: str | None) -> str | None:
            if not value:
                return None
            return f"***{value[-4:]}" if len(value) > 8 else "***"

        return {
            "guild_id": self.guild_id,
            "mention_trigger": self.mention_trigger,
            "command_prefix": self.command_prefix,
            "ephemeral": self.ephemeral,
            "cooldown_seconds": self.cooldown_seconds,
            "privacy_role_id": self.privacy_role_id,
            "github_enrich": self.github_enrich,
            "github_token": mask(self.github_token),
            "data_path": str(self.data_path),
            "log_level": self.log_level,
            "presence_intent": self.presence_intent,
            "token": mask(self.token),
        }


def from_env(env: Mapping[str, str] | None = None, *, require_token: bool = True) -> Config:
    """Dựng ``Config`` từ biến môi trường, báo lỗi rõ ràng nếu thiếu."""
    env = os.environ if env is None else env

    token = (env.get("DISCORD_TOKEN") or "").strip()
    if require_token and not token:
        raise ConfigError(
            "Thiếu DISCORD_TOKEN. Tạo bot tại https://discord.com/developers/applications, "
            "copy token vào file .env (xem .env.example)."
        )

    mention_trigger = (env.get("MENTION_TRIGGER") or "bot").strip().lower()
    if mention_trigger not in MENTION_TRIGGERS:
        raise ConfigError(f"MENTION_TRIGGER phải là một trong {MENTION_TRIGGERS}, nhận {mention_trigger!r}")

    log_level = (env.get("LOG_LEVEL") or "INFO").strip().upper()
    if log_level not in LOG_LEVELS:
        raise ConfigError(f"LOG_LEVEL phải là một trong {LOG_LEVELS}, nhận {log_level!r}")

    prefix = (env.get("COMMAND_PREFIX") or "!info").strip()
    if not prefix or " " in prefix or len(prefix) > 16:
        raise ConfigError("COMMAND_PREFIX không hợp lệ (1-16 ký tự, không có khoảng trắng)")

    data_path = Path((env.get("DATA_PATH") or str(DEFAULT_DATA_PATH)).strip())

    return Config(
        token=token,
        guild_id=_get_int(env, "GUILD_ID", None),
        mention_trigger=mention_trigger,
        command_prefix=prefix,
        ephemeral=_get_bool(env, "EPHEMERAL", False),
        cooldown_seconds=_get_float(env, "COOLDOWN_SECONDS", 8.0, minimum=0.0),
        privacy_role_id=_get_int(env, "PRIVACY_ROLE_ID", None),
        github_token=(env.get("GITHUB_TOKEN") or "").strip() or None,
        github_enrich=_get_bool(env, "GITHUB_ENRICH", False),
        data_path=data_path,
        log_level=log_level,
        presence_intent=_get_bool(env, "PRESENCE_INTENT", False),
    )
