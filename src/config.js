/**
 * Nạp cấu hình từ biến môi trường (kèm đọc .env khi chạy local).
 * Trên panel hosting (Botkeep…) thì biến môi trường do panel cấp, không cần .env.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_DATA_PATH = 'data/accounts.json';
export const MENTION_TRIGGERS = ['bot', 'any', 'off'];
export const LOG_LEVELS = ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Nạp file .env vào process.env (không ghi đè biến đã tồn tại). */
export function loadDotenv(path = '.env', env = process.env) {
  const loaded = [];
  const full = resolve(path);
  if (!existsSync(full)) return loaded;
  let text;
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    return loaded;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    let [key, ...rest] = line.split('=');
    key = key.trim();
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    if (!key || !/^[A-Za-z0-9_]+$/.test(key)) continue;
    let value = rest.join('=').trim();
    if (value.length >= 2 && value[0] === value.at(-1) && '"\''.includes(value[0])) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) {
      env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}

function getBool(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  throw new ConfigError(`${key} phải là true/false, nhận "${raw}"`);
}

function getInt(env, key, fallback, { minimum = 1 } = {}) {
  const raw = env[key];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value)) throw new ConfigError(`${key} phải là số nguyên, nhận "${raw}"`);
  if (value < minimum) throw new ConfigError(`${key} phải >= ${minimum}, nhận ${value}`);
  return value;
}

function getFloat(env, key, fallback, { minimum = 0 } = {}) {
  const raw = env[key];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (Number.isNaN(value)) throw new ConfigError(`${key} phải là số, nhận "${raw}"`);
  if (value < minimum) throw new ConfigError(`${key} phải >= ${minimum}, nhận ${value}`);
  return value;
}

/** Dựng cấu hình đã validate từ biến môi trường. */
export function fromEnv(env = process.env, { requireToken = true } = {}) {
  const token = String(env.DISCORD_TOKEN ?? '').trim();
  if (requireToken && !token) {
    throw new ConfigError(
      'Thiếu DISCORD_TOKEN. Tạo bot tại https://discord.com/developers/applications → Bot → ' +
        'Reset Token, rồi đặt biến môi trường DISCORD_TOKEN (máy local: file .env theo ' +
        '.env.example; panel hosting như Botkeep: mục Environment/Secrets, KHÔNG upload .env).',
    );
  }

  const mentionTrigger = String(env.MENTION_TRIGGER ?? 'bot').trim().toLowerCase();
  if (!MENTION_TRIGGERS.includes(mentionTrigger)) {
    throw new ConfigError(
      `MENTION_TRIGGER phải là một trong ${MENTION_TRIGGERS.join(', ')}, nhận "${mentionTrigger}"`,
    );
  }

  const logLevel = String(env.LOG_LEVEL ?? 'INFO').trim().toUpperCase();
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL phải là một trong ${LOG_LEVELS.join(', ')}, nhận "${logLevel}"`);
  }

  const commandPrefix = String(env.COMMAND_PREFIX ?? '!info').trim();
  if (!commandPrefix || commandPrefix.includes(' ') || commandPrefix.length > 16) {
    throw new ConfigError('COMMAND_PREFIX không hợp lệ (1-16 ký tự, không có khoảng trắng)');
  }

  return Object.freeze({
    token,
    guildId: getInt(env, 'GUILD_ID', null),
    mentionTrigger,
    commandPrefix,
    ephemeral: getBool(env, 'EPHEMERAL', false),
    cooldownSeconds: getFloat(env, 'COOLDOWN_SECONDS', 8),
    privacyRoleId: getInt(env, 'PRIVACY_ROLE_ID', null),
    githubToken: String(env.GITHUB_TOKEN ?? '').trim() || null,
    githubEnrich: getBool(env, 'GITHUB_ENRICH', false),
    dataPath: String(env.DATA_PATH ?? DEFAULT_DATA_PATH).trim(),
    logLevel,
    presenceIntent: getBool(env, 'PRESENCE_INTENT', false),
  });
}

/** Bản cấu hình an toàn để log (đã che token). */
export function redactConfig(config) {
  const mask = (value) => {
    if (!value) return null;
    return value.length > 8 ? `***${value.slice(-4)}` : '***';
  };
  return {
    guildId: config.guildId,
    mentionTrigger: config.mentionTrigger,
    commandPrefix: config.commandPrefix,
    ephemeral: config.ephemeral,
    cooldownSeconds: config.cooldownSeconds,
    privacyRoleId: config.privacyRoleId,
    githubEnrich: config.githubEnrich,
    githubToken: mask(config.githubToken),
    dataPath: config.dataPath,
    logLevel: config.logLevel,
    presenceIntent: config.presenceIntent,
    token: mask(config.token),
  };
}
