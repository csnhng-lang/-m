#!/usr/bin/env node
/**
 * Entry point bot Discord — mention @user để xem hồ sơ tài khoản chi tiết.
 *
 * Chạy:  npm start        (hoặc: node src/index.js)
 * Panel hosting (Botkeep…): startup command `npm start`, secret đặt ở Environment.
 */

import process from 'node:process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ActivityType, Client, Events, GatewayIntentBits, MessageType } from 'discord.js';

import { CONTEXT_MENU_NAME, commandData, handleInteraction } from './commands.js';
import { ConfigError, fromEnv, loadDotenv, redactConfig } from './config.js';
import { buildHelpEmbed } from './embeds.js';
import { GitHubClient } from './github.js';
import { MAX_TARGETS_PER_MESSAGE, renderProfile } from './render.js';
import { AccountStore, StoreError } from './store.js';

const PREFIX_FOLLOW_CHARS = new Set([' ', '\n', '<']);

// --------------------------------------------------------------------------- //
// Logging (ra stdout để panel hiện trong Console)
// --------------------------------------------------------------------------- //
const LEVELS = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3, DEBUG: 4 };

function createLogger(level = 'INFO') {
  const threshold = LEVELS[String(level).toUpperCase()] ?? LEVELS.INFO;
  const stamp = () => new Date().toTimeString().slice(0, 8);
  const emit = (name, write) => (message) => {
    if (LEVELS[name] <= threshold) write(`${stamp()} | ${name.padEnd(7)} | accountbot | ${message}`);
  };
  return {
    critical: emit('CRITICAL', console.error),
    error: emit('ERROR', console.error),
    warning: emit('WARNING', console.warn),
    info: emit('INFO', console.log),
    debug: emit('DEBUG', console.log),
  };
}

/** Tin nhắn có bắt đầu bằng tiền tố lệnh? (tránh khớp "!information") */
export function matchesPrefix(content, prefix) {
  const text = String(content ?? '');
  if (!text.startsWith(prefix)) return false;
  const rest = text.slice(prefix.length);
  if (rest === '') return true;
  if (PREFIX_FOLLOW_CHARS.has(rest[0])) return true;
  return rest.trim() === '';
}

export function buildIntents(config) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // cần cho vai trò / ngày vào server
    GatewayIntentBits.GuildMessages,
  ];
  if (config.mentionTrigger !== 'off') intents.push(GatewayIntentBits.MessageContent);
  if (config.presenceIntent) intents.push(GatewayIntentBits.GuildPresences);
  return intents;
}

// --------------------------------------------------------------------------- //
// Bot
// --------------------------------------------------------------------------- //
export class AccountBot {
  constructor(config) {
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.client = new Client({
      intents: buildIntents(config),
      allowedMentions: { parse: [], repliedUser: false },
      presence: {
        status: 'online',
        activities: [{ name: '@user để xem hồ sơ', type: ActivityType.Watching }],
      },
    });
    this.store = new AccountStore(config.dataPath);
    this.github = config.githubEnrich ? new GitHubClient({ token: config.githubToken }) : null;
    this.cooldowns = new Map();
    this.ctx = {
      client: this.client,
      store: this.store,
      config,
      github: this.github,
      logger: this.logger,
    };
    this.#wireEvents();
  }

  #wireEvents() {
    this.client.once(Events.ClientReady, () => this.#onReady());
    this.client.on(Events.InteractionCreate, (interaction) => {
      handleInteraction(interaction, this.ctx).catch((error) =>
        this.logger.error(`Lỗi interaction: ${error.stack ?? error}`),
      );
    });
    this.client.on(Events.MessageCreate, (message) => {
      this.#onMessage(message).catch((error) =>
        this.logger.error(`Lỗi xử lý tin nhắn: ${error.stack ?? error}`),
      );
    });
    this.client.on(Events.Error, (error) => this.logger.error(`Lỗi client: ${error.message}`));
    this.client.on(Events.Warn, (info) => this.logger.warning(`Cảnh báo client: ${info}`));
  }

  async start() {
    await this.store.load();
    this.logger.info(`Đã nạp ${this.store.size} hồ sơ từ ${this.config.dataPath}`);
    await this.client.login(this.config.token);
  }

  async stop() {
    this.logger.info('Đang dừng bot...');
    await this.client.destroy();
  }

  // --- ready / đăng ký lệnh --------------------------------------------- //
  async #onReady() {
    this.logger.info(`Đã đăng nhập: ${this.client.user.tag}`);
    if (this.config.mentionTrigger !== 'off') {
      this.logger.info(
        'Đang bật đọc nội dung tin nhắn — nhớ bật MESSAGE CONTENT INTENT trong Discord Developer Portal.',
      );
    }
    if (this.config.presenceIntent) {
      this.logger.info('Đang bật PRESENCE INTENT — nhớ bật trong Developer Portal.');
    }
    try {
      const data = commandData();
      let count = data.length;
      if (this.config.guildId) {
        const guild = await this.client.guilds.fetch(String(this.config.guildId));
        count = (await guild.commands.set(data)).size;
      } else {
        count = (await this.client.application.commands.set(data)).size;
      }
      this.logger.info(
        this.config.guildId
          ? `Đã đồng bộ ${count} lệnh vào guild ${this.config.guildId}`
          : `Đã đồng bộ ${count} lệnh toàn cục (có thể mất tới 1 giờ mới hiện; đặt GUILD_ID để hiện ngay)`,
      );
    } catch (error) {
      this.logger.error(`Đồng bộ lệnh slash thất bại: ${error.message}`);
    }
  }

  // --- chống spam -------------------------------------------------------- //
  isCoolingDown(guildId, targetId) {
    if (this.config.cooldownSeconds <= 0) return false;
    const key = `${guildId}:${targetId}`;
    const now = Date.now();
    const last = this.cooldowns.get(key);
    if (last !== undefined && now - last < this.config.cooldownSeconds * 1000) return true;
    this.cooldowns.set(key, now);
    if (this.cooldowns.size > 4096) {
      const cutoff = now - this.config.cooldownSeconds * 1000;
      for (const [entryKey, at] of this.cooldowns) {
        if (at < cutoff) this.cooldowns.delete(entryKey);
      }
    }
    return false;
  }

  // --- mention ----------------------------------------------------------- //
  async #onMessage(message) {
    if (!message.inGuild() || message.author.bot) return;
    if (message.author.id === this.client.user.id) return;

    const content = message.content ?? '';
    const prefixUsed = matchesPrefix(content, this.config.commandPrefix);
    const selfMentioned = message.mentions.users.has(this.client.user.id);
    const targets = [];

    if (prefixUsed) {
      for (const user of message.mentions.users.values()) {
        if (user.id !== this.client.user.id) targets.push(user);
      }
    } else if (this.config.mentionTrigger === 'bot' && selfMentioned) {
      for (const user of message.mentions.users.values()) {
        if (user.id !== this.client.user.id) targets.push(user);
      }
    } else if (this.config.mentionTrigger === 'any' && message.type === MessageType.Default) {
      for (const user of message.mentions.users.values()) {
        if (user.id !== this.client.user.id) targets.push(user);
      }
    }

    if (!targets.length) {
      if ((prefixUsed || selfMentioned) && !this.isCoolingDown(message.guildId, 0)) {
        await message.reply({
          embeds: [
            buildHelpEmbed({
              prefix: this.config.commandPrefix,
              mentionTrigger: this.config.mentionTrigger,
              privacyEnabled: this.config.privacyRoleId !== null,
            }),
          ],
          allowedMentions: { parse: [], repliedUser: false },
        });
      }
      return;
    }

    const selected = [];
    const seen = new Set();
    for (const user of targets) {
      if (seen.has(user.id)) continue;
      if (this.isCoolingDown(message.guildId, user.id)) continue;
      seen.add(user.id);
      selected.push(user);
      if (selected.length >= MAX_TARGETS_PER_MESSAGE) break;
    }
    if (!selected.length) {
      this.logger.debug(`Bỏ qua mention (cooldown) ở guild ${message.guildId}`);
      return;
    }

    const embeds = [];
    for (const target of selected) {
      embeds.push(
        await renderProfile({
          target,
          guild: message.guild,
          invokerMember: message.member,
          invokerName: message.author.globalName ?? message.author.username,
          store: this.store,
          config: this.config,
          github: this.github,
          client: this.client,
          showPrivate: false,
        }),
      );
    }

    try {
      await message.reply({ embeds, allowedMentions: { parse: [], repliedUser: false } });
    } catch (error) {
      this.logger.warning(`Không gửi được embed ở kênh ${message.channelId}: ${error.message}`);
    }
  }
}

/**
 * Một số panel coi process là "chết" nếu không mở cổng. Nếu panel cấp HEALTH_PORT/PORT,
 * bot mở một endpoint nhỏ để panel thấy tiến trình còn sống.
 */
export function startHealthServer(logger) {
  // Botkeep/Pterodactyl có thể đặt SERVER_PORT; một số panel khác dùng PORT.
  const rawPort =
    process.env.HEALTH_PORT ?? process.env.SERVER_PORT ?? process.env.PORT ?? '';
  const port = Number.parseInt(String(rawPort), 10);
  if (!Number.isInteger(port) || port <= 0) return null;

  const startedAt = Date.now();
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(
      JSON.stringify({ ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }),
    );
  });
  server.on('error', (error) => logger.warning(`Không mở được health port ${port}: ${error.message}`));
  server.listen(port, '0.0.0.0', () => {
    logger.info(`Health endpoint: http://0.0.0.0:${port}/ (giữ tiến trình sống nếu panel yêu cầu cổng)`);
  });
  return server;
}

// --------------------------------------------------------------------------- //
// Khởi động
// --------------------------------------------------------------------------- //
export async function main() {
  loadDotenv();
  const step = (index, total, message) => console.log(`${new Date().toTimeString().slice(0, 8)} | STEP    | accountbot | [${index}/${total}] ${message}`);

  step(1, 5, 'đọc cấu hình từ biến môi trường');
  let config;
  try {
    config = fromEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[cấu hình] ${error.message}`);
      return 2;
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  logger.info(`Cấu hình: ${JSON.stringify(redactConfig(config))}`);

  // Bắt lỗi không lường trước để panel không "im lặng tắt" mà có dòng log rõ ràng.
  process.on('uncaughtException', (error) => {
    logger.critical(`Lỗi không bắt được (uncaughtException): ${error?.stack ?? error}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.critical(`Promise bị từ chối không xử lý (unhandledRejection): ${reason?.stack ?? reason}`);
    process.exit(1);
  });

  step(2, 5, `kiểm tra dữ liệu tại ${config.dataPath}`);
  const preflight = new AccountStore(config.dataPath);
  try {
    await preflight.load();
    logger.info(`Dữ liệu hợp lệ: ${preflight.size} hồ sơ`);
  } catch (error) {
    if (error instanceof StoreError) {
      logger.error(`Không nạp được dữ liệu: ${error.message}`);
      return 3;
    }
    throw error;
  }

  const bot = new AccountBot(config);
  const healthServer = startHealthServer(logger);

  const shutdown = async (signal) => {
    logger.info(`Nhận ${signal}, đang dừng...`);
    healthServer?.close();
    await bot.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  step(3, 5, 'đăng nhập Discord');
  try {
    await bot.start();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (message.includes('An invalid token was provided') || message.includes('401')) {
      logger.error('DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi.');
      return 4;
    }
    if (message.includes('Used disallowed intents') || message.toLowerCase().includes('privileged')) {
      logger.error(
        'Bot chưa bật privileged intents cần thiết (MESSAGE CONTENT / SERVER MEMBERS / PRESENCE) ' +
          'trong Developer Portal.',
      );
      return 5;
    }
    logger.error(`Không khởi động được bot: ${message}`);
    logger.error('Chạy `npm run doctor -- --login` để biết chính xác nguyên nhân.');
    return 1;
  }

  step(4, 5, 'đăng ký lệnh slash (xem log phía trên)');
  step(5, 5, 'bot đang chạy — giữ tiến trình ở foreground');

  // Giữ process sống (panel theo dõi tiến trình ở foreground).
  await new Promise(() => {});
  return 0;
}

const isDirectRun =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((code) => {
      if (code) process.exit(code);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

