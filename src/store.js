/**
 * Kho dữ liệu JSON — tương đương `store.py`.
 *
 * - Giữ toàn bộ file trong bộ nhớ, mọi thay đổi đi qua API có kiểm tra.
 * - Ghi atomic (tmp + fsync + rename): mất điện giữa lúc ghi cũng không hỏng file.
 * - File hỏng/không hợp lệ -> ném StoreError kèm vị trí lỗi, KHÔNG tự ghi đè.
 * - Tuần tự hoá các lần ghi để tránh đè lẫn nhau khi có nhiều lệnh cùng lúc.
 */

import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  createProfile,
  profileFromJson,
  profileToJson,
  removeAccount,
  upsertAccount,
} from './accounts.js';
import {
  MAX_DISPLAY_NAME_LEN,
  MAX_NOTE_LEN,
  ValidationError,
  cleanField,
} from './text.js';

export const STORE_VERSION = 1;

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

export class AccountStore {
  #users = new Map();
  #loaded = false;
  #queue = Promise.resolve();

  constructor(path, { fs = null } = {}) {
    this.path = path;
    this.fs = fs ?? { mkdir, open, readFile, rename, unlink };
  }

  // --- nạp / lưu -------------------------------------------------------- //

  async load({ createIfMissing = true } = {}) {
    let raw = null;
    try {
      raw = await this.fs.readFile(this.path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new StoreError(`Không đọc được ${this.path}: ${error.message}`);
      }
      if (!createIfMissing) throw new StoreError(`Không tìm thấy file dữ liệu: ${this.path}`);
      this.#users = new Map();
      this.#loaded = true;
      await this.save();
      return;
    }

    if (!raw.trim()) {
      this.#users = new Map();
      this.#loaded = true;
      return;
    }

    let document;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new StoreError(
        `${this.path} không phải JSON hợp lệ: ${error.message}. ` +
          'Sửa tay hoặc khôi phục từ git; bot sẽ không ghi đè dữ liệu của bạn.',
      );
    }

    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      throw new StoreError(`${this.path}: nội dung gốc phải là object JSON`);
    }

    const version = document.version ?? STORE_VERSION;
    if (!Number.isInteger(version) || version > STORE_VERSION) {
      throw new StoreError(
        `${this.path}: version ${JSON.stringify(version)} không được hỗ trợ (bot hiểu version <= ${STORE_VERSION})`,
      );
    }

    let usersRaw = document.users ?? {};
    if (usersRaw === null || typeof usersRaw !== 'object' || Array.isArray(usersRaw)) {
      throw new StoreError(`${this.path}: "users" phải là object JSON (key = ID Discord)`);
    }

    const users = new Map();
    for (const [discordId, payload] of Object.entries(usersRaw)) {
      const key = String(discordId).trim();
      if (!/^\d+$/.test(key)) {
        throw new StoreError(`${this.path}: khoá "${discordId}" không phải ID Discord hợp lệ`);
      }
      try {
        users.set(key, profileFromJson(key, payload));
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new StoreError(`${this.path}: ${error.message}`);
        }
        throw error;
      }
    }

    this.#users = users;
    this.#loaded = true;
  }

  async reload() {
    await this.load({ createIfMissing: false });
  }

  async save() {
    this.#queue = this.#queue.then(() => this.#write());
    return this.#queue;
  }

  async #write() {
    const document = {
      version: STORE_VERSION,
      updated_at: new Date().toISOString(),
      users: Object.fromEntries(
        [...this.#users.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([id, profile]) => [id, profileToJson(profile)]),
      ),
    };
    const payload = `${JSON.stringify(document, null, 2)}\n`;
    const dir = dirname(this.path);
    await this.fs.mkdir(dir, { recursive: true });

    const tmpPath = `${dir}/.${this.path.split('/').pop()}.${process.pid}.${Date.now()}.tmp`;
    let handle = null;
    try {
      handle = await this.fs.open(tmpPath, 'w');
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.fs.rename(tmpPath, this.path); // atomic trên cùng filesystem
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await this.fs.unlink(tmpPath).catch(() => {});
      throw new StoreError(`Không ghi được ${this.path}: ${error.message}`);
    }
  }

  // --- truy vấn --------------------------------------------------------- //

  get size() {
    return this.#users.size;
  }

  get users() {
    return new Map(this.#users);
  }

  get(userId) {
    return this.#users.get(String(userId)) ?? null;
  }

  getOrCreate(userId) {
    const key = String(userId);
    let profile = this.#users.get(key);
    if (!profile) {
      profile = createProfile(key);
      profile.updatedAt = new Date().toISOString();
      this.#users.set(key, profile);
    }
    return profile;
  }

  // --- thay đổi --------------------------------------------------------- //

  async upsertAccount(userId, account) {
    const profile = this.getOrCreate(userId);
    const isNew = upsertAccount(profile, account);
    await this.save();
    return isNew;
  }

  async removeAccount(userId, type, handle) {
    const profile = this.get(userId);
    if (!profile) return false;
    if (!removeAccount(profile, type, handle)) return false;
    if (!profile.accounts.length && !profile.displayName && !profile.notes) {
      this.#users.delete(String(userId));
    }
    await this.save();
    return true;
  }

  async setDisplayName(userId, displayName) {
    const profile = this.getOrCreate(userId);
    profile.displayName = cleanField(displayName ?? '', {
      name: 'display_name',
      maxLen: MAX_DISPLAY_NAME_LEN,
      context: 'nguoidung',
      required: false,
    });
    profile.updatedAt = new Date().toISOString();
    await this.save();
  }

  async setNotes(userId, notes) {
    const profile = this.getOrCreate(userId);
    profile.notes = cleanField(notes ?? '', {
      name: 'notes',
      maxLen: MAX_NOTE_LEN,
      context: 'nguoidung',
      required: false,
      singleLine: false,
    });
    profile.updatedAt = new Date().toISOString();
    await this.save();
  }
}
