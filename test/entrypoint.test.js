/**
 * Test entry point `src/index.js` — hợp đồng deploy của panel hosting:
 * thiếu cấu hình phải thoát với mã lỗi rõ ràng, không treo process.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ENTRY = resolve('src/index.js');

function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(DISCORD_|GITHUB_|GUILD_|DATA_|LOG_LEVEL)/.test(key),
    ),
  );
  return { ...env, ...extra };
}

async function runNode(args, env) {
  try {
    const { stdout, stderr } = await exec(process.execPath, args, { env, timeout: 60000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

describe('src/index.js', () => {
  it('thiếu DISCORD_TOKEN -> exit 2 kèm hướng dẫn', async () => {
    const result = await runNode([ENTRY], cleanEnv());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /DISCORD_TOKEN/);
  });

  it('DISCORD_TOKEN sai -> exit 4', async () => {
    const dataPath = join(mkdtempSync(join(tmpdir(), 'entry-')), 'accounts.json');
    const result = await runNode(
      [ENTRY],
      cleanEnv({
        DISCORD_TOKEN: `not-a-real-token-${'a'.repeat(40)}`,
        DATA_PATH: dataPath,
        LOG_LEVEL: 'ERROR',
      }),
    );
    assert.equal(result.code, 4);
    assert.match(result.stderr + result.stdout, /DISCORD_TOKEN/);
  });

  it('file dữ liệu hỏng -> exit 3 (không ghi đè)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'entry-'));
    const dataPath = join(dir, 'accounts.json');
    writeFileSync(dataPath, '{bad', 'utf8');
    const result = await runNode(
      [ENTRY],
      cleanEnv({
        DISCORD_TOKEN: `not-a-real-token-${'a'.repeat(40)}`,
        DATA_PATH: dataPath,
        LOG_LEVEL: 'ERROR',
      }),
    );
    assert.equal(result.code, 3);
    assert.match(result.stderr + result.stdout, /JSON/);
  });
});
