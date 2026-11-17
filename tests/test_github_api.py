"""Test cho client GitHub (dùng session giả, không gọi mạng)."""

from __future__ import annotations

import asyncio

import pytest

from github_api import GitHubClient, GitHubError

PAYLOAD = {
    "login": "csnhng-lang",
    "html_url": "https://github.com/csnhng-lang",
    "name": "Cao Sy Nhan",
    "bio": "Backend dev",
    "company": "@example",
    "location": "Bac Ninh",
    "public_repos": 14,
    "followers": 37,
    "following": 12,
    "created_at": "2022-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
}


class FakeResponse:
    def __init__(self, status: int, payload=None, *, headers=None, text: str = "") -> None:
        self.status = status
        self._payload = payload
        self.headers = headers or {}
        self._text = text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def json(self, content_type=None):
        return self._payload

    async def text(self):
        return self._text


class FakeSession:
    """Session giả: trả về lần lượt các response trong hàng đợi."""

    def __init__(self, *responses: FakeResponse) -> None:
        self.responses = list(responses)
        self.calls = 0
        self.closed = False

    def get(self, url, headers=None):  # noqa: ARG002
        self.calls += 1
        if not self.responses:
            raise AssertionError("gọi GitHub nhiều hơn số response đã chuẩn bị")
        return self.responses.pop(0)


def make_client(session: FakeSession, *, ttl: float = 300.0) -> GitHubClient:
    return GitHubClient(token="ghp_test", ttl_seconds=ttl, session=session)


def test_fetch_success():
    session = FakeSession(FakeResponse(200, PAYLOAD))
    client = make_client(session)
    profile = asyncio.run(client.fetch("csnhng-lang"))
    assert profile is not None
    assert profile.login == "csnhng-lang"
    assert profile.public_repos == 14
    assert profile.followers == 37
    assert profile.created_at is not None
    assert session.calls == 1


def test_cache_avoids_second_request():
    session = FakeSession(FakeResponse(200, PAYLOAD))
    client = make_client(session)
    asyncio.run(client.fetch("csnhng-lang"))
    asyncio.run(client.fetch("CSNHNG-LANG"))  # khác hoa/thường nhưng cùng cache key
    assert session.calls == 1


def test_cache_expires():
    session = FakeSession(FakeResponse(200, PAYLOAD), FakeResponse(200, PAYLOAD))
    client = make_client(session, ttl=0)
    asyncio.run(client.fetch("csnhng-lang"))
    asyncio.run(client.fetch("csnhng-lang"))
    assert session.calls == 2


def test_not_found_returns_none_and_is_cached():
    session = FakeSession(FakeResponse(404, {}))
    client = make_client(session)
    assert asyncio.run(client.fetch("khong-ton-tai-xyz")) is None
    assert asyncio.run(client.fetch("khong-ton-tai-xyz")) is None
    assert session.calls == 1


def test_rate_limit_reports_reset_time():
    session = FakeSession(
        FakeResponse(
            403,
            {"message": "API rate limit exceeded"},
            headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "9999999999"},
        )
    )
    client = make_client(session)
    with pytest.raises(GitHubError) as excinfo:
        asyncio.run(client.fetch("csnhng-lang"))
    assert "quota" in str(excinfo.value).lower()


def test_secondary_rate_limit_message():
    session = FakeSession(
        FakeResponse(429, {"message": "You have exceeded a secondary rate limit"}, text="secondary rate limit")
    )
    client = make_client(session)
    with pytest.raises(GitHubError) as excinfo:
        asyncio.run(client.fetch("csnhng-lang"))
    assert "giới hạn" in str(excinfo.value).lower()


def test_server_error():
    session = FakeSession(FakeResponse(500, {}))
    client = make_client(session)
    with pytest.raises(GitHubError) as excinfo:
        asyncio.run(client.fetch("csnhng-lang"))
    assert "500" in str(excinfo.value)


def test_network_error_is_wrapped():
    import aiohttp

    class BoomSession(FakeSession):
        def get(self, url, headers=None):
            raise aiohttp.ClientError("mất mạng")

    client = make_client(BoomSession())
    with pytest.raises(GitHubError) as excinfo:
        asyncio.run(client.fetch("csnhng-lang"))
    assert "mạng" in str(excinfo.value)


def test_empty_login_skips_request():
    session = FakeSession()
    client = make_client(session)
    assert asyncio.run(client.fetch("   ")) is None
    assert session.calls == 0


def test_bio_is_sanitized():
    payload = {**PAYLOAD, "bio": "@everyone **free nitro**"}
    session = FakeSession(FakeResponse(200, payload))
    profile = asyncio.run(make_client(session).fetch("csnhng-lang"))
    assert "**free nitro**" not in profile.bio
    assert "\\*\\*free nitro\\*\\*" in profile.bio
