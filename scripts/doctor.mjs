#!/usr/bin/env node
/**
 * Tự chẩn đoán vì sao bot "bật lên là tự tắt".
 *
 *   npm run doctor              # kiểm tra môi trường, KHÔNG kết nối Discord
 *   npm run doctor -- --login   # kiểm tra thêm token bằng cách đăng nhập thật
 *
 * Mã thoát: 0 = không có lỗi chặn, 1 = có lỗi chặn.
 */

import process from 'node:process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { MENTION_TRIGGERS, loadDotenv } from '../src/config.js';

const results = [];

function record(status, label, detail = '', hint = '') {
  results.push({ status, label, detail, hint });
}

const ICON = { ok: '✅', warn: '⚠️ ', fail: '❌' };

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) {
    record('ok', 'Phiên bản Node', `v${process.versions.node}`);
  } else {
    record(
      'fail',
      'Phiên bản Node',
      `v${process.versions.node} (cần >= 18)`,
      'Chọn runtime Node 18+ trong panel (Botkeep: Node 22).',
    );
  }
}

function checkWorkingDir() {
  const cwd = process.cwd();
  const hasPackage = existsSync(resolve(cwd, 'package.json'));
  const hasSrc = existsSync(resolve(cwd, 'src/index.js'));
  if (hasPackage && hasSrc) {
    record('ok', 'Thư mục làm việc', cwd);
  } else {
    record(
      'fail',
      'Thư mục làm việc',
      `${cwd} — thiếu ${!hasPackage ? 'package.json ' : ''}${!hasSrc ? 'src/index.js' : ''}`,
      'Trên panel: đặt "Project root" về thư mục có package.json (không phải thư mục con).',
    );
  }
}

async function checkDependencies() {
  try {
    await import('discord.js');
  } catch (error) {
    const installed = existsSync(resolve('node_modules/discord.js'));
    record(
      'fail',
      'dependency discord.js',
      installed ? `có thư mục nhưng không nạp được: ${error.message}` : 'CHƯA cài (node_modules không có discord.js)',
      'Đặt startup command thành `npm ci && npm start`, hoặc bấm "Install dependencies"/Reinstall trong panel.',
    );
    return;
  }

  // discord.js không export package.json, nên tìm ngược lên để đọc version.
  let version = 'đã nạp được';
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve('discord.js'));
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
        if (pkg.name === 'discord.js') {
          version = `v${pkg.version}`;
          break;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* giữ thông báo mặc định */
  }
  record('ok', 'dependency discord.js', version);
}

function checkToken() {
  const token = String(process.env.DISCORD_TOKEN ?? '').trim();
  if (!token) {
    record(
      'fail',
      'DISCORD_TOKEN',
      'CHƯA ĐẶT',
      'Panel → Environment/Secrets → thêm DISCORD_TOKEN = token bot (không upload .env).',
    );
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3 || token.length < 50) {
    record('warn', 'DISCORD_TOKEN', 'đã đặt nhưng nhìn không giống token Discord', 'Kiểm tra dấu cách/xuống dòng khi copy.');
  } else {
    record('ok', 'DISCORD_TOKEN', `đã đặt (…${token.slice(-4)}, ${token.length} ký tự)`);
  }
  return token;
}

function checkEnvVars() {
  const guildId = String(process.env.GUILD_ID ?? '').trim();
  if (guildId && !/^\d+$/.test(guildId)) {
    record('warn', 'GUILD_ID', `"${guildId}" không phải số`, 'GUILD_ID chỉ gồm chữ số (Copy Server ID).');
  } else {
    record('ok', 'GUILD_ID', guildId || '(trống — lệnh slash có thể mất tới 1 giờ mới hiện)');
  }

  const trigger = String(process.env.MENTION_TRIGGER ?? 'bot').trim().toLowerCase();
  if (MENTION_TRIGGERS.includes(trigger)) {
    record('ok', 'MENTION_TRIGGER', trigger);
  } else {
    record('fail', 'MENTION_TRIGGER', `"${trigger}" không hợp lệ`, `Dùng một trong: ${MENTION_TRIGGERS.join(', ')}.`);
  }

  for (const key of ['PRESENCE_INTENT', 'GITHUB_ENRICH', 'EPHEMERAL']) {
    const raw = String(process.env[key] ?? '').trim().toLowerCase();
    if (!raw) continue;
    if (['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n'].includes(raw)) {
      record('ok', key, raw);
    } else {
      record('fail', key, `"${raw}" không phải boolean`, 'Dùng true hoặc false.');
    }
  }
}

function checkDataPath() {
  const dataPath = resolve(String(process.env.DATA_PATH ?? 'data/accounts.json').trim());
  const dir = dirname(dataPath);
  try {
    if (!existsSync(dir)) {
      writeFileSync(`${dir}.doctor-probe`, 'x', 'utf8');
      unlinkSync(`${dir}.doctor-probe`);
      record('warn', 'Thư mục dữ liệu', `${dir} chưa có nhưng tạo được`);
      return;
    }
    const probe = `${dir}/.doctor-probe`;
    writeFileSync(probe, 'x', 'utf8');
    unlinkSync(probe);
    record('ok', 'Thư mục dữ liệu', `${dir} (ghi được)`);
  } catch (error) {
    record(
      'fail',
      'Thư mục dữ liệu',
      `không ghi được ${dir}: ${error.message}`,
      'Đặt DATA_PATH vào thư mục ghi được, ví dụ /home/container/data/accounts.json.',
    );
  }

  if (existsSync(dataPath)) {
    try {
      const raw = readFileSync(dataPath, 'utf8');
      const document = JSON.parse(raw);
      const count = Object.keys(document.users ?? {}).length;
      record('ok', 'File dữ liệu', `${dataPath} (${count} hồ sơ, ${statSync(dataPath).size} bytes)`);
    } catch (error) {
      record(
        'fail',
        'File dữ liệu',
        `${dataPath} không phải JSON hợp lệ: ${error.message}`,
        'Sửa tay hoặc xoá file rỗng/hỏng rồi khởi động lại (bot sẽ tự tạo file mới).',
      );
    }
  } else {
    record('ok', 'File dữ liệu', `${dataPath} (chưa có — sẽ tự tạo)`);
  }
}

async function checkLogin(token) {
  if (!token) {
    record('warn', 'Đăng nhập thử', 'bỏ qua vì thiếu DISCORD_TOKEN');
    return;
  }
  let Client;
  let GatewayIntentBits;
  try {
    ({ Client, GatewayIntentBits } = await import('discord.js'));
  } catch (error) {
    record('fail', 'Đăng nhập thử', `không nạp được discord.js: ${error.message}`);
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 25000));
  try {
    await Promise.race([client.login(token), timeout]);
    await Promise.race([client.application.fetch(), timeout]);
    const guilds = client.guilds.cache.size;
    record('ok', 'Đăng nhập thử', `thành công: ${client.user.tag} · ${guilds} server`);
    if (guilds === 0) {
      record('warn', 'Bot chưa ở server nào', 'mời bot bằng link OAuth2 (xem docs/INVITE.md)');
    }
    const commands = await client.application.commands.fetch().catch(() => null);
    if (commands) {
      record('ok', 'Lệnh slash toàn cục', `${commands.size} lệnh trên Discord`);
    }
  } catch (error) {
    const message = String(error?.message ?? error);
    let hint = '';
    if (message.includes('invalid token') || message.includes('401') || message.includes('TOKEN_INVALID')) {
      hint = 'Token sai hoặc đã bị Reset → Developer Portal → Bot → Reset Token → dán lại vào Environment.';
    } else if (message.toLowerCase().includes('disallowed intents')) {
      hint = 'Bật MESSAGE CONTENT INTENT + SERVER MEMBERS INTENT ở Developer Portal → Bot.';
    } else if (message === 'TIMEOUT') {
      hint = 'Không kết nối được tới Discord từ host (mạng/firewall) — thử lại hoặc restart server.';
    }
    record('fail', 'Đăng nhập thử', message, hint);
  } finally {
    await client.destroy().catch(() => {});
  }
}

function printReport() {
  console.log('\n================ CHẨN ĐOÁN BOT ================');
  for (const item of results) {
    console.log(`${ICON[item.status]} ${item.label}: ${item.detail}`);
    if (item.hint) console.log(`     → ${item.hint}`);
  }
  const fails = results.filter((item) => item.status === 'fail');
  const warns = results.filter((item) => item.status === 'warn');
  console.log('==============================================');
  if (fails.length) {
    console.log(`\nKẾT LUẬN: ${fails.length} lỗi chặn khởi động — sửa theo mũi tên ở trên.`);
    return 1;
  }
  if (warns.length) {
    console.log(`\nKẾT LUẬN: không có lỗi chặn, có ${warns.length} cảnh báo. Bot có thể chạy được.`);
    return 0;
  }
  console.log('\nKẾT LUẬN: mọi thứ ổn. Chạy `npm start`.');
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  loadDotenv();
  console.log(`Kiểm tra môi trường — thư mục: ${process.cwd()}`);
  checkNodeVersion();
  checkWorkingDir();
  await checkDependencies();
  const token = checkToken();
  checkEnvVars();
  checkDataPath();
  if (argv.includes('--login')) {
    await checkLogin(token);
  } else {
    console.log('\n(Chưa kiểm tra token. Thêm --login để bot thử đăng nhập thật: npm run doctor -- --login)');
  }
  return printReport();
}

const isDirectRun = process.argv[1]?.endsWith('doctor.mjs');
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('Lỗi khi chạy chẩn đoán:', error);
      process.exit(1);
    });
}
