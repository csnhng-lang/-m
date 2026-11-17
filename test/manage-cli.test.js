import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SCRIPT = resolve('scripts/manage.mjs');

function tempData() {
  return join(mkdtempSync(join(tmpdir(), 'cli-')), 'accounts.json');
}

async function run(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [SCRIPT, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

describe('scripts/manage.mjs', () => {
  it('thêm rồi liệt kê', async () => {
    const data = tempData();
    const add = await run(['add', '--user', '42', '--type', 'github', '--handle', 'csnhng-lang', '--data', data]);
    assert.equal(add.code, 0);
    assert.match(add.stdout, /Đã thêm github\/csnhng-lang/);

    const list = await run(['list', '--data', data]);
    assert.equal(list.code, 0);
    assert.match(list.stdout, /github\/csnhng-lang/);
  });

  it('validate báo số hồ sơ', async () => {
    const data = tempData();
    await run(['add', '--user', '42', '--type', 'steam', '--handle', 'gaben', '--data', data]);
    const result = await run(['validate', '--data', data]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Hợp lệ: 1 hồ sơ, 1 tài khoản/);
  });

  it('từ chối type sai (exit 2)', async () => {
    const data = tempData();
    const result = await run(['add', '--user', '42', '--type', 'GIT HUB', '--handle', 'x', '--data', data]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Lỗi dữ liệu/);
  });

  it('từ chối url javascript:', async () => {
    const data = tempData();
    const result = await run([
      'add', '--user', '42', '--type', 'github', '--handle', 'x',
      '--url', 'javascript:alert(1)', '--data', data,
    ]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /url/);
  });

  it('từ chối user không phải số', async () => {
    const data = tempData();
    const result = await run(['add', '--user', 'abc', '--type', 'github', '--handle', 'x', '--data', data]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /ID Discord/);
  });

  it('xoá tài khoản không tồn tại trả exit 1', async () => {
    const data = tempData();
    await run(['add', '--user', '42', '--type', 'github', '--handle', 'a', '--data', data]);
    const result = await run(['remove', '--user', '42', '--type', 'github', '--handle', 'khong-co', '--data', data]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Không tìm thấy/);
  });

  it('file JSON hợp lệ sau nhiều lần sửa', async () => {
    const data = tempData();
    await run(['add', '--user', '42', '--type', 'github', '--handle', 'a', '--data', data]);
    await run(['add', '--user', '42', '--type', 'steam', '--handle', 'b', '--visibility', 'restricted', '--data', data]);
    await run(['note', '--user', '42', '--text', 'Khách VIP', '--data', data]);
    const document = JSON.parse(readFileSync(data, 'utf8'));
    assert.equal(document.version, 1);
    assert.equal(document.users['42'].accounts.length, 2);
    assert.equal(document.users['42'].notes, 'Khách VIP');
  });

  it('báo lỗi rõ khi file hỏng', async () => {
    const data = tempData();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(data, '{bad', 'utf8');
    const result = await run(['list', '--data', data]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Lỗi dữ liệu/);
  });
});
