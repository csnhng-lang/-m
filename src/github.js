/**
 * Tra hồ sơ GitHub công khai (tuỳ chọn) — tương đương `github_api.py`.
 * Chỉ dùng endpoint public, có cache TTL, xử lý 404 và rate limit.
 */

import { sanitizeText } from './text.js';

export const GITHUB_API = 'https://api.github.com/users/';
export const USER_AGENT = 'discord-account-bot/1.0';

export class GitHubError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitHubError';
  }
}

function toDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toInt(value) {
  const parsed = Number.parseInt(value ?? 0, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Chuẩn hoá payload API thành object dùng cho embed. */
export function profileFromApi(payload) {
  const login = String(payload.login ?? '');
  return {
    login,
    htmlUrl: String(payload.html_url ?? `https://github.com/${login}`),
    name: sanitizeText(payload.name ?? '', { maxLen: 80 }),
    bio: sanitizeText(payload.bio ?? '', { maxLen: 160, singleLine: false }),
    company: sanitizeText(payload.company ?? '', { maxLen: 60 }),
    location: sanitizeText(payload.location ?? '', { maxLen: 60 }),
    publicRepos: toInt(payload.public_repos),
    followers: toInt(payload.followers),
    following: toInt(payload.following),
    createdAt: toDate(payload.created_at),
    updatedAt: toDate(payload.updated_at),
  };
}

export class GitHubClient {
  /**
   * @param {object} options
   * @param {string|null} options.token
   * @param {number} options.ttlSeconds
   * @param {number} options.timeoutMs
   * @param {typeof fetch} options.fetchImpl  cho phép inject để test
   */
  constructor({ token = null, ttlSeconds = 300, timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
    this.token = token || null;
    this.ttlMs = Math.max(0, ttlSeconds) * 1000;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.cache = new Map(); // lower(login) -> { at: number, value }
  }

  headers() {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  /** @returns {Promise<object|null>} null nếu không tồn tại; ném GitHubError nếu lỗi khác. */
  async fetch(login) {
    const cleaned = String(login ?? '').trim();
    if (!cleaned) return null;

    const key = cleaned.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value;

    const value = await this.request(cleaned);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async request(login) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${GITHUB_API}${encodeURIComponent(login)}`, {
        headers: this.headers(),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new GitHubError('GitHub không phản hồi kịp (timeout)');
      }
      throw new GitHubError(`Lỗi mạng khi gọi GitHub: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) {
      const body = await response.text().catch(() => '');
      throw new GitHubError(this.rateLimitMessage(response, body));
    }
    if (response.status >= 400) {
      throw new GitHubError(`GitHub trả về HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new GitHubError('GitHub trả về dữ liệu không mong đợi');
    }
    if (!payload || typeof payload !== 'object') {
      throw new GitHubError('GitHub trả về dữ liệu không mong đợi');
    }
    return profileFromApi(payload);
  }

  rateLimitMessage(response, body = '') {
    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    const reset = response.headers?.get?.('x-ratelimit-reset');
    if (remaining === '0' && reset) {
      const resetSeconds = Number.parseInt(reset, 10);
      if (!Number.isNaN(resetSeconds)) {
        const waitMinutes = Math.max(1, Math.ceil((resetSeconds * 1000 - Date.now()) / 60000));
        return `Hết quota GitHub API, thử lại sau ~${waitMinutes} phút`;
      }
    }
    if (String(body).toLowerCase().includes('secondary rate limit')) {
      return 'GitHub đang giới hạn tạm thời (secondary rate limit), thử lại sau';
    }
    return 'GitHub từ chối truy cập (403/429). Thêm GITHUB_TOKEN để có hạn mức cao hơn.';
  }
}
