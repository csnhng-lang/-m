"""Test entry point `main.py` (hợp đồng deploy của các panel hosting)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRYPOINT = ROOT / "main.py"


def run_entrypoint(**env_overrides: str) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DISCORD_", "GITHUB_", "DATA_", "GUILD_"))}
    env.update(env_overrides)
    env["PYTHONPATH"] = str(ROOT)
    return subprocess.run(
        [sys.executable, str(ENTRYPOINT)],
        capture_output=True,
        text=True,
        timeout=90,
        cwd=str(ROOT),
        env=env,
    )


def test_entrypoint_exists():
    assert ENTRYPOINT.is_file()


def test_missing_token_exits_2_with_clear_message():
    result = run_entrypoint()
    assert result.returncode == 2
    assert "DISCORD_TOKEN" in result.stderr


def test_invalid_token_exits_4(tmp_path):
    result = run_entrypoint(
        DISCORD_TOKEN="not-a-real-token-" + "a" * 40,
        DATA_PATH=str(tmp_path / "accounts.json"),
        LOG_LEVEL="ERROR",
    )
    assert result.returncode == 4
    assert "DISCORD_TOKEN" in (result.stderr + result.stdout)
