#!/usr/bin/env node
/**
 * CLI quản lý kho tài khoản — bản Node.js của scripts/manage.py.
 *
 * Ví dụ:
 *   node scripts/manage.mjs list
 *   node scripts/manage.mjs show 123456789012345678
 *   node scripts/manage.mjs add --user 123456789012345678 --type github \
 *       --handle csnhng-lang --label "GitHub chính" --url https://github.com/csnhng-lang
 *   node scripts/manage.mjs remove --user 123456789012345678 --type github --handle csnhng-lang
 *   node scripts/manage.mjs note --user 123456789012345678 --text "Khách VIP"
 *   node scripts/manage.mjs validate
 */

import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAccount, visibleAccounts } from '../src/accounts.js';
import { DEFAULT_DATA_PATH, loadDotenv } from '../src/config.js';
import { AccountStore, StoreError } from '../src/store.js';
import { ValidationError } from '../src/text.js';

const BOOLEAN_FLAGS = new Set(['verified', 'create', 'help']);

/** Tách argv thành { command, positional, flags }. */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i += 1;
    }
  }
  return { command: positional[0] ?? null, positional: positional.slice(1), flags };
}

export function dataPath(flags = {}) {
  if (flags.data) return resolve(String(flags.data));
  loadDotenv();
  const env = process.env;
  if (env.DATA_PATH) return resolve(env.DATA_PATH);
  return resolve(DEFAULT_DATA_PATH);
}

async function openStore(flags, { create = false } = {}) {
  const store = new AccountStore(dataPath(flags));
  await store.load({ createIfMissing: create });
  return store;
}

function printProfile(userId, profile) {
  if (!profile) {
    console.log(`• ${userId}: (chưa có dữ liệu)`);
    return;
  }
  console.log(`• ${userId}${profile.displayName ? ` — ${profile.displayName}` : ''}`);
  if (profile.notes) console.log(`  ghi chú: ${profile.notes}`);
  if (!profile.accounts.length) console.log('  (không có tài khoản liên kết)');
  for (const account of visibleAccounts(profile, { isStaff: true })) {
    const flags = [];
    if (account.verified) flags.push('verified');
    if (account.visibility !== 'public') flags.push('restricted');
    const extra = flags.length ? ` [${flags.join(', ')}]` : '';
    const label = account.label ? ` (${account.label})` : '';
    console.log(`  - ${account.type}/${account.handle}${label}${extra}`);
    if (account.url) console.log(`    ${account.url}`);
  }
}

const COMMANDS = {
  async list({ flags }) {
    const store = await openStore(flags, { create: Boolean(flags.create) });
    if (!store.size) {
      console.log(`Kho dữ liệu trống: ${store.path}`);
      return 0;
    }
    console.log(`${store.size} hồ sơ trong ${store.path}:`);
    for (const userId of [...store.users.keys()].sort()) {
      printProfile(userId, store.get(userId));
    }
    return 0;
  },

  async show({ positional, flags }) {
    const userId = positional[0];
    if (!userId) {
      console.error('Thiếu ID Discord: node scripts/manage.mjs show <userId>');
      return 2;
    }
    const store = await openStore(flags);
    if (!store.get(userId)) {
      console.error(`Không có dữ liệu cho ${userId}`);
      return 1;
    }
    printProfile(userId, store.get(userId));
    return 0;
  },

  async add({ flags }) {
    const userId = String(flags.user ?? '');
    if (!/^\d+$/.test(userId)) {
      console.error('--user phải là ID Discord (chỉ gồm chữ số)');
      return 2;
    }
    const store = await openStore(flags, { create: true });
    let account;
    try {
      account = createAccount({
        type: flags.type,
        handle: flags.handle,
        label: flags.label ?? '',
        url: flags.url ?? '',
        visibility: flags.visibility ?? 'public',
        verified: Boolean(flags.verified),
        note: flags.note ?? '',
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`Lỗi dữ liệu: ${error.message}`);
        return 2;
      }
      throw error;
    }
    const isNew = await store.upsertAccount(userId, account);
    console.log(`${isNew ? 'Đã thêm' : 'Đã cập nhật'} ${account.type}/${account.handle} cho ${userId}`);
    return 0;
  },

  async remove({ flags }) {
    const store = await openStore(flags);
    const removed = await store.removeAccount(flags.user, flags.type, flags.handle);
    if (!removed) {
      console.error(`Không tìm thấy ${flags.type}/${flags.handle} của ${flags.user}`);
      return 1;
    }
    console.log(`Đã xoá ${flags.type}/${flags.handle} của ${flags.user}`);
    return 0;
  },

  async note({ flags }) {
    const store = await openStore(flags, { create: true });
    try {
      await store.setNotes(flags.user, flags.text ?? '');
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`Lỗi dữ liệu: ${error.message}`);
        return 2;
      }
      throw error;
    }
    console.log(`Đã cập nhật ghi chú cho ${flags.user}`);
    return 0;
  },

  async validate({ flags }) {
    const store = await openStore(flags);
    const total = [...store.users.values()].reduce((sum, profile) => sum + profile.accounts.length, 0);
    console.log(`Hợp lệ: ${store.size} hồ sơ, ${total} tài khoản — ${store.path}`);
    return 0;
  },
};

function printHelp() {
  console.log(
    [
      'Quản lý kho tài khoản của bot Discord',
      '',
      'Lệnh:',
      '  list                          liệt kê toàn bộ hồ sơ',
      '  show <userId>                 xem một hồ sơ',
      '  add --user --type --handle    thêm/cập nhật tài khoản',
      '      [--label --url --visibility public|restricted --verified --note]',
      '  remove --user --type --handle xoá tài khoản',
      '  note --user [--text]          đặt ghi chú nội bộ',
      '  validate                      kiểm tra file dữ liệu',
      '',
      'Tuỳ chọn chung: --data <path> (mặc định $DATA_PATH hoặc data/accounts.json)',
    ].join('\n'),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help' || args.flags.help) {
    printHelp();
    return 0;
  }
  const handler = COMMANDS[args.command];
  if (!handler) {
    console.error(`Lệnh không hỗ trợ: ${args.command}`);
    printHelp();
    return 2;
  }
  try {
    return await handler(args);
  } catch (error) {
    if (error instanceof StoreError) {
      console.error(`Lỗi dữ liệu: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

const isDirectRun =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
