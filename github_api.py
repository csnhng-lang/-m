"""Tra cứu hồ sơ GitHub công khai (tuỳ chọn).

Chỉ dùng dữ liệu công khai từ ``api.github.com/users/{login}`` và chỉ chạy khi
``GITHUB_ENRICH=true``. Có cache TTL, xử lý 404 và rate limit 403/429, không
bao giờ làm hỏng luồng trả lời chính nếu GitHub lỗi.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import aiohttp

from models import ensure_utc, sanitize_text, utc_now

LOGGER = logging.getLogger(__name__)
GITHUB_API = "https://api.github.com/users/{login}"
USER_AGENT = "discord-account-bot/1.0"


class GitHubError(RuntimeError):
    """Lỗi khi gọi API GitHub (mạng, rate limit, ...)."""


@dataclass(frozen=True, slots=True)
class GitHubProfile:
    login: str
    html_url: str
    name: str = ""
    bio: str = ""
    company: str = ""
    location: str = ""
    public_repos: int = 0
    followers: int = 0
    following: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_api(cls, payload: dict[str, Any]) -> GitHubProfile:
        def as_int(key: str) -> int:
            try:
                return int(payload.get(key) or 0)
            except (TypeError, ValueError):
                return 0

        def as_date(key: str) -> datetime | None:
            raw = payload.get(key)
            if not isinstance(raw, str):
                return None
            try:
                return ensure_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))
            except ValueError:
                return None

        login = str(payload.get("login") or "")
        return cls(
            login=login,
            html_url=str(payload.get("html_url") or f"https://github.com/{login}"),
            name=sanitize_text(payload.get("name") or "", max_len=80),
            bio=sanitize_text(payload.get("bio") or "", max_len=160, single_line=False),
            company=sanitize_text(payload.get("company") or "", max_len=60),
            location=sanitize_text(payload.get("location") or "", max_len=60),
            public_repos=as_int("public_repos"),
            followers=as_int("followers"),
            following=as_int("following"),
            created_at=as_date("created_at"),
            updated_at=as_date("updated_at"),
        )


class GitHubClient:
    """Client nhỏ, có cache trong bộ nhớ. Một instance dùng chung cho cả bot."""

    def __init__(
        self,
        *,
        token: str | None = None,
        ttl_seconds: float = 300.0,
        timeout_seconds: float = 8.0,
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self._token = token or None
        self._ttl = max(0.0, ttl_seconds)
        self._timeout = timeout_seconds
        self._session = session
        self._owns_session = session is None
        self._cache: dict[str, tuple[float, GitHubProfile | None]] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------ #
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self._timeout),
                headers=self._headers(),
            )
            self._owns_session = True
        return self._session

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    async def close(self) -> None:
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()
        self._session = None

    # ------------------------------------------------------------------ #
    async def fetch(self, login: str) -> GitHubProfile | None:
        """Trả về hồ sơ, ``None`` nếu không tồn tại. Ném ``GitHubError`` nếu lỗi khác."""
        login = (login or "").strip()
        if not login:
            return None

        cache_key = login.lower()
        cached = self._cache.get(cache_key)
        now = time.monotonic()
        if cached and now - cached[0] < self._ttl:
            return cached[1]

        async with self._lock:
            cached = self._cache.get(cache_key)
            now = time.monotonic()
            if cached and now - cached[0] < self._ttl:
                return cached[1]
            profile = await self._request(login)
            self._cache[cache_key] = (time.monotonic(), profile)
            return profile

    async def _request(self, login: str) -> GitHubProfile | None:
        session = await self._get_session()
        url = GITHUB_API.format(login=login)
        try:
            async with session.get(url, headers=self._headers()) as response:
                if response.status == 404:
                    return None
                if response.status in (403, 429):
                    body = await response.text()
                    raise GitHubError(self._rate_limit_message(response, body))
                if response.status >= 400:
                    raise GitHubError(f"GitHub trả về HTTP {response.status}")
                payload = await response.json(content_type=None)
        except TimeoutError as exc:
            raise GitHubError("GitHub không phản hồi kịp (timeout)") from exc
        except aiohttp.ClientError as exc:
            raise GitHubError(f"Lỗi mạng khi gọi GitHub: {exc}") from exc

        if not isinstance(payload, dict):
            raise GitHubError("GitHub trả về dữ liệu không mong đợi")
        return GitHubProfile.from_api(payload)

    @staticmethod
    def _rate_limit_message(response: aiohttp.ClientResponse, body: str) -> str:
        if response.headers.get("X-RateLimit-Remaining") == "0":
            reset = response.headers.get("X-RateLimit-Reset")
            if reset and reset.isdigit():
                try:
                    wait = max(0, int(reset) - int(utc_now().timestamp()))
                    return f"Hết quota GitHub API, thử lại sau ~{wait // 60 + 1} phút"
                except ValueError:
                    pass
        if "secondary rate limit" in body.lower():
            return "GitHub đang giới hạn tạm thời (secondary rate limit), thử lại sau"
        return "GitHub từ chối truy cập (403/429). Thêm GITHUB_TOKEN để có hạn mức cao hơn."
