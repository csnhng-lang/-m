import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { createAccount } from '../src/accounts.js';
import { AccountStore, STORE_VERSION, StoreError } from '../src/store.js';
import { ValidationError } from '../src/text.js';

function tempPath(name = 'accounts.json') {
  const dir = mkdtempSync(join(tmpdir(), 'store-'));
  return join(dir, name);
}

describe('AccountStore', () => {
  let path;

  beforeEach(() => {
    path = tempPath();
  });

  it('tự tạo file khi chưa có', async () => {
    const store = new AccountStore(path);
    await store.load();
    assert.equal(store.size, 0);
    const document = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(document.version, STORE_VERSION);
    assert.deepEqual(document.users, {});
  });

  it('thêm và đọc lại được', async () => {
    const store = new AccountStore(path);
    await store.load();
    const account = createAccount({ type: 'github', handle: 'csnhng-lang', label: 'GitHub' });
    assert.equal(await store.upsertAccount('123', account), true);
    assert.equal(await store.upsertAccount('123', account), false);

    const reloaded = new AccountStore(path);
    await reloaded.load();
    const profile = reloaded.get('123');
    assert.equal(profile.accounts.length, 1);
    assert.equal(profile.accounts[0].handle, 'csnhng-lang');
  });

  it('không để lại file tạm', async () => {
    const store = new AccountStore(path);
    await store.load();
    await store.upsertAccount('1', createAccount({ type: 'steam', handle: 'x' }));
    const leftovers = readdirSync(path.replace('accounts.json', '')).filter((name) =>
      name.endsWith('.tmp'),
    );
    assert.deepEqual(leftovers, []);
  });

  it('xoá tài khoản cuối thì xoá luôn hồ sơ', async () => {
    const store = new AccountStore(path);
    await store.load();
    await store.upsertAccount('1', createAccount({ type: 'steam', handle: 'x' }));
    assert.equal(await store.removeAccount('1', 'steam', 'x'), true);
    assert.equal(store.get('1'), null);
    assert.equal(await store.removeAccount('1', 'steam', 'x'), false);
  });

  it('lưu ghi chú và tên nội bộ', async () => {
    const store = new AccountStore(path);
    await store.load();
    await store.setNotes('7', 'ghi chú\nnhiều dòng');
    await store.setDisplayName('7', 'Tên nội bộ');
    assert.equal(store.get('7').notes, 'ghi chú\nnhiều dòng');
    assert.equal(store.get('7').displayName, 'Tên nội bộ');
  });

  it('từ chối ghi chú quá dài', async () => {
    const store = new AccountStore(path);
    await store.load();
    await assert.rejects(() => store.setNotes('7', 'x'.repeat(501)), ValidationError);
  });

  it('file JSON hỏng: báo lỗi và KHÔNG ghi đè', async () => {
    writeFileSync(path, '{ hỏng json', 'utf8');
    const store = new AccountStore(path);
    await assert.rejects(() => store.load(), StoreError);
    assert.equal(readFileSync(path, 'utf8'), '{ hỏng json');
  });

  it('version không hỗ trợ', async () => {
    writeFileSync(path, JSON.stringify({ version: 99, users: {} }), 'utf8');
    await assert.rejects(() => new AccountStore(path).load(), StoreError);
  });

  for (const payload of [
    { version: 1, users: [] },
    { version: 1, users: { abc: {} } },
    { version: 1, users: { 1: { accounts: 'x' } } },
    { version: 1, users: { 1: { accounts: [{ type: 'github' }] } } },
    { version: 1, users: { 1: { accounts: [{ type: 'github', handle: 'a' }, { type: 'github', handle: 'A' }] } } },
  ]) {
    it(`schema sai: ${JSON.stringify(payload).slice(0, 60)}`, async () => {
      writeFileSync(path, JSON.stringify(payload), 'utf8');
      await assert.rejects(() => new AccountStore(path).load(), StoreError);
    });
  }

  it('file rỗng coi như kho trống', async () => {
    writeFileSync(path, '   \n', 'utf8');
    const store = new AccountStore(path);
    await store.load();
    assert.equal(store.size, 0);
  });

  it('giữ nguyên UTF-8 trên đĩa', async () => {
    const store = new AccountStore(path);
    await store.load();
    await store.setNotes('1', 'Nguyễn Văn Ánh — 日本語');
    assert.ok(readFileSync(path, 'utf8').includes('Nguyễn Văn Ánh'));
  });

  it('nhiều lần ghi song song vẫn ra file hợp lệ', async () => {
    const store = new AccountStore(path);
    await store.load();
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.upsertAccount('1', createAccount({ type: 'github', handle: `user${index}` })),
      ),
    );
    const document = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(document.users['1'].accounts.length, 10);
  });
});
