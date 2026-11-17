import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GitHubClient, GitHubError } from '../src/github.js';

const PAYLOAD = {
  login: 'csnhng-lang',
  html_url: 'https://github.com/csnhng-lang',
  name: 'Cao Sy Nhan',
  bio: 'Backend dev',
  company: '@example',
  location: 'Bac Ninh',
  public_repos: 14,
  followers: 37,
  following: 12,
  created_at: '2022-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function fakeResponse(status, { payload = null, headers = {}, body = '' } = {}) {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? headers[name] ?? null },
    async json() {
      return payload;
    },
    async text() {
      return body;
    },
  };
}

function makeClient(responses, { ttlSeconds = 300 } = {}) {
  const queue = [...responses];
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (!queue.length) throw new Error('gọi GitHub nhiều hơn số response đã chuẩn bị');
    return queue.shift();
  };
  const client = new GitHubClient({ token: 'ghp_test', ttlSeconds, fetchImpl });
  return { client, calls };
}

describe('GitHubClient', () => {
  it('tra cứu thành công', async () => {
    const { client, calls } = makeClient([fakeResponse(200, { payload: PAYLOAD })]);
    const profile = await client.fetch('csnhng-lang');
    assert.equal(profile.login, 'csnhng-lang');
    assert.equal(profile.publicRepos, 14);
    assert.equal(profile.followers, 37);
    assert.ok(profile.createdAt instanceof Date);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer ghp_test');
  });

  it('cache tránh gọi lại', async () => {
    const { client, calls } = makeClient([fakeResponse(200, { payload: PAYLOAD })]);
    await client.fetch('csnhng-lang');
    await client.fetch('CSNHNG-LANG');
    assert.equal(calls.length, 1);
  });

  it('cache hết hạn thì gọi lại', async () => {
    const { client, calls } = makeClient(
      [fakeResponse(200, { payload: PAYLOAD }), fakeResponse(200, { payload: PAYLOAD })],
      { ttlSeconds: 0 },
    );
    await client.fetch('csnhng-lang');
    await client.fetch('csnhng-lang');
    assert.equal(calls.length, 2);
  });

  it('404 trả về null và được cache', async () => {
    const { client, calls } = makeClient([fakeResponse(404)]);
    assert.equal(await client.fetch('khong-ton-tai'), null);
    assert.equal(await client.fetch('khong-ton-tai'), null);
    assert.equal(calls.length, 1);
  });

  it('rate limit 403 báo thời gian chờ', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    const { client } = makeClient([
      fakeResponse(403, {
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
        body: 'API rate limit exceeded',
      }),
    ]);
    await assert.rejects(() => client.fetch('a'), (error) => {
      assert.ok(error instanceof GitHubError);
      assert.match(error.message.toLowerCase(), /quota/);
      return true;
    });
  });

  it('secondary rate limit', async () => {
    const { client } = makeClient([
      fakeResponse(429, { body: 'You have exceeded a secondary rate limit' }),
    ]);
    await assert.rejects(() => client.fetch('a'), /giới hạn/);
  });

  it('lỗi 5xx', async () => {
    const { client } = makeClient([fakeResponse(500)]);
    await assert.rejects(() => client.fetch('a'), /500/);
  });

  it('lỗi mạng được bọc lại', async () => {
    const client = new GitHubClient({
      fetchImpl: async () => {
        throw new Error('mất mạng');
      },
    });
    await assert.rejects(() => client.fetch('a'), /mạng/);
  });

  it('login rỗng thì không gọi mạng', async () => {
    const { client, calls } = makeClient([]);
    assert.equal(await client.fetch('   '), null);
    assert.equal(calls.length, 0);
  });

  it('bio được làm sạch markdown', async () => {
    const { client } = makeClient([
      fakeResponse(200, { payload: { ...PAYLOAD, bio: '@everyone **free nitro**' } }),
    ]);
    const profile = await client.fetch('csnhng-lang');
    assert.ok(!profile.bio.includes('**free nitro**'));
    assert.ok(profile.bio.includes('\\*\\*free nitro\\*\\*'));
  });

  it('không có token thì không gửi header Authorization', async () => {
    const calls = [];
    const client = new GitHubClient({
      fetchImpl: async (url, options) => {
        calls.push(options);
        return fakeResponse(200, { payload: PAYLOAD });
      },
    });
    await client.fetch('x');
    assert.equal(calls[0].headers.Authorization, undefined);
  });
});
