/**
 * Kiểu dữ liệu tài khoản/hồ sơ + kiểm tra hợp lệ (tương đương dataclass trong models.py).
 * Không import discord.js để test và CLI dùng được độc lập.
 */

import {
  MAX_ACCOUNT_TYPE_LEN,
  MAX_DISPLAY_NAME_LEN,
  MAX_HANDLE_LEN,
  MAX_LABEL_LEN,
  MAX_NOTE_LEN,
  ValidationError,
  cleanField,
  isValidUrl,
  parseIso,
  toIso,
} from './text.js';

export const VISIBILITY_PUBLIC = 'public';
export const VISIBILITY_RESTRICTED = 'restricted';
export const VISIBILITIES = [VISIBILITY_PUBLIC, VISIBILITY_RESTRICTED];

/**
 * Tạo một tài khoản liên kết đã validate.
 * @returns {{type:string, handle:string, label:string, url:string, visibility:string,
 *            verified:boolean, note:string, addedAt:string|null}}
 */
export function createAccount({
  type,
  handle,
  label = '',
  url = '',
  visibility = VISIBILITY_PUBLIC,
  verified = false,
  note = '',
  addedAt = null,
} = {}) {
  return accountFromJson(
    { type, handle, label, url, visibility, verified, note, added_at: addedAt ?? new Date().toISOString() },
    { context: 'taikhoan' },
  );
}

export function accountFromJson(raw, { context = 'taikhoan' } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`${context}: phải là object JSON`);
  }

  const type = cleanField(raw.type, {
    name: 'type',
    maxLen: MAX_ACCOUNT_TYPE_LEN,
    context,
  }).toLowerCase();
  const handle = cleanField(raw.handle, { name: 'handle', maxLen: MAX_HANDLE_LEN, context });

  const visibility = String(raw.visibility ?? VISIBILITY_PUBLIC).trim().toLowerCase();
  if (!VISIBILITIES.includes(visibility)) {
    throw new ValidationError(
      `${context}: visibility phải là một trong ${VISIBILITIES.join(', ')}, nhận "${visibility}"`,
    );
  }

  const url = String(raw.url ?? '').trim();
  if (url && !isValidUrl(url)) {
    throw new ValidationError(`${context}: url không hợp lệ (chỉ chấp nhận http/https)`);
  }

  if (raw.verified !== undefined && typeof raw.verified !== 'boolean') {
    throw new ValidationError(`${context}: verified phải là true/false`);
  }

  return {
    type,
    handle,
    label: cleanField(raw.label ?? '', {
      name: 'label',
      maxLen: MAX_LABEL_LEN,
      context,
      required: false,
    }),
    url,
    visibility,
    verified: raw.verified === true,
    note: cleanField(raw.note ?? '', {
      name: 'note',
      maxLen: MAX_NOTE_LEN,
      context,
      required: false,
      singleLine: false,
    }),
    addedAt: toIso(parseIso(raw.added_at, `${context}.added_at`)),
  };
}

export function accountToJson(account) {
  const json = {
    type: account.type,
    handle: account.handle,
    visibility: account.visibility,
    verified: Boolean(account.verified),
  };
  if (account.label) json.label = account.label;
  if (account.url) json.url = account.url;
  if (account.note) json.note = account.note;
  if (account.addedAt) json.added_at = account.addedAt;
  return json;
}

/** Khoá định danh duy nhất của tài khoản (không phân biệt hoa/thường). */
export function accountKey(account) {
  return `${account.type.toLowerCase()}/${account.handle.toLowerCase()}`;
}

export function isPublic(account) {
  return account.visibility === VISIBILITY_PUBLIC;
}

export function createProfile(userId) {
  return { userId: String(userId), displayName: '', notes: '', accounts: [], updatedAt: null };
}

export function profileFromJson(userId, raw, { context = `users[${userId}]` } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`${context}: phải là object JSON`);
  }
  const accountsRaw = raw.accounts ?? [];
  if (!Array.isArray(accountsRaw)) {
    throw new ValidationError(`${context}: accounts phải là mảng`);
  }
  const accounts = [];
  const seen = new Set();
  accountsRaw.forEach((item, index) => {
    const account = accountFromJson(item, { context: `${context}.accounts[${index}]` });
    const key = accountKey(account);
    if (seen.has(key)) {
      throw new ValidationError(`${context}: tài khoản trùng lặp ${account.type}/${account.handle}`);
    }
    seen.add(key);
    accounts.push(account);
  });

  return {
    userId: String(userId),
    displayName: cleanField(raw.display_name ?? '', {
      name: 'display_name',
      maxLen: MAX_DISPLAY_NAME_LEN,
      context,
      required: false,
    }),
    notes: cleanField(raw.notes ?? '', {
      name: 'notes',
      maxLen: MAX_NOTE_LEN,
      context,
      required: false,
      singleLine: false,
    }),
    accounts,
    updatedAt: toIso(parseIso(raw.updated_at, `${context}.updated_at`)),
  };
}

export function profileToJson(profile) {
  return {
    display_name: profile.displayName,
    notes: profile.notes,
    updated_at: toIso(profile.updatedAt),
    accounts: profile.accounts.map(accountToJson),
  };
}

/** Thêm hoặc ghi đè tài khoản. Trả về true nếu là bản ghi mới. */
export function upsertAccount(profile, account) {
  const key = accountKey(account);
  const index = profile.accounts.findIndex((item) => accountKey(item) === key);
  profile.updatedAt = new Date().toISOString();
  if (index === -1) {
    profile.accounts.push(account);
    return true;
  }
  profile.accounts[index] = account;
  return false;
}

export function removeAccount(profile, type, handle) {
  const key = `${type.toLowerCase()}/${handle.toLowerCase()}`;
  const before = profile.accounts.length;
  profile.accounts = profile.accounts.filter((item) => accountKey(item) !== key);
  if (profile.accounts.length !== before) {
    profile.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
}

export function findAccount(profile, type, handle) {
  const key = `${type.toLowerCase()}/${handle.toLowerCase()}`;
  return profile.accounts.find((item) => accountKey(item) === key) ?? null;
}

/** Danh sách tài khoản được phép hiển thị, đã sắp xếp theo type/handle. */
export function visibleAccounts(profile, { isStaff = false } = {}) {
  if (!profile) return [];
  return [...profile.accounts]
    .filter((item) => isStaff || isPublic(item))
    .sort((a, b) => {
      const aKey = `${a.type}/${a.handle.toLowerCase()}`;
      const bKey = `${b.type}/${b.handle.toLowerCase()}`;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
}
