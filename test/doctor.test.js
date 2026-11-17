/**
 * Test `npm run doctor` — công cụ chẩn đoán khi bot "bật lên là tự tắt".
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const DOCTOR = resolve('scripts/doctor.mjs');

function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(DISCORD_|GITHUB_|GUILD_|DATA_|LOG_LEVEL|HEALTH_PORT|PORT)/.test(key),
    ),
  );
  return { ...env, ...extra };
}

async function runDoctor(args, env) {
  try {
    const { stdout } = await exec(process.execPath, [DOCTOR, ...args], { env, timeout: 90000 });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '' };
  }
}

describe('scripts/doctor.mjs', () => {
  it('phát hiện thiếu DISCORD_TOKEN và trả exit 1', async () => {
    const result = await runDoctor([], cleanEnv({ DATA_PATH: join(mkdtempSync(join(tmpdir(), 'doc-')), 'a.json') }));
    assert.equal(result.code, 1);
    assert.match(result.stdout, /DISCORD_TOKEN: CHƯA ĐẶT/);
    assert.match(result.stdout, /KẾT LUẬN: \d+ lỗi chặn/);
  });

  it('báo môi trường ổn khi có token hợp lệ về định dạng', async () => {
    const fakeToken = `${'A'.repeat(24)}.${'B'.repeat(6)}.${'C'.repeat(38)}`;
    const result = await runDoctor(
      [],
      cleanEnv({
        DISCORD_TOKEN: fakeToken,
        DATA_PATH: join(mkdtempSync(join(tmpdir(), 'doc-')), 'a.json'),
      }),
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /dependency discord.js/);
    assert.match(result.stdout, /mọi thứ ổn/);
  });

  it('cảnh báo khi GUILD_ID không phải số', async () => {
    const fakeToken = `${'A'.repeat(24)}.${'B'.repeat(6)}.${'C'.repeat(38)}`;
    const result = await runDoctor(
      [],
      cleanEnv({
        DISCORD_TOKEN: fakeToken,
        GUILD_ID: 'abc',
        DATA_PATH: join(mkdtempSync(join(tmpdir(), 'doc-')), 'a.json'),
      }),
    );
    assert.match(result.stdout, /GUILD_ID: "abc" không phải số/);
  });
});
