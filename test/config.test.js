import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ConfigError, fromEnv, loadDotenv, redactConfig } from '../src/config.js';

const TOKEN = 'a'.repeat(70);

describe('fromEnv', () => {
  it('cấu hình tối thiểu', () => {
    const config = fromEnv({ DISCORD_TOKEN: TOKEN });
    assert.equal(config.guildId, null);
    assert.equal(config.mentionTrigger, 'bot');
    assert.equal(config.cooldownSeconds, 8);
    assert.equal(config.githubEnrich, false);
  });

  it('thiếu token thì báo lỗi rõ ràng', () => {
    assert.throws(() => fromEnv({}), ConfigError);
  });

  it('cho phép thiếu token khi requireToken=false', () => {
    assert.equal(fromEnv({}, { requireToken: false }).token, '');
  });

  for (const value of ['true', '1', 'yes', 'ON']) {
    it(`nhận boolean true: ${value}`, () => {
      assert.equal(fromEnv({ DISCORD_TOKEN: TOKEN, EPHEMERAL: value }).ephemeral, true);
    });
  }

  for (const value of ['false', '0', 'no', 'OFF']) {
    it(`nhận boolean false: ${value}`, () => {
      assert.equal(fromEnv({ DISCORD_TOKEN: TOKEN, EPHEMERAL: value }).ephemeral, false);
    });
  }

  it('từ chối boolean sai', () => {
    assert.throws(() => fromEnv({ DISCORD_TOKEN: TOKEN, EPHEMERAL: 'maybe' }), ConfigError);
  });

  for (const value of ['0', '-5', 'abc']) {
    it(`từ chối GUILD_ID: ${value}`, () => {
      assert.throws(() => fromEnv({ DISCORD_TOKEN: TOKEN, GUILD_ID: value }), ConfigError);
    });
  }

  it('GUILD_ID rỗng nghĩa là không đặt', () => {
    assert.equal(fromEnv({ DISCORD_TOKEN: TOKEN, GUILD_ID: '' }).guildId, null);
  });

  it('từ chối MENTION_TRIGGER lạ', () => {
    assert.throws(() => fromEnv({ DISCORD_TOKEN: TOKEN, MENTION_TRIGGER: 'x' }), ConfigError);
  });

  it('từ chối COMMAND_PREFIX có khoảng trắng', () => {
    assert.throws(() => fromEnv({ DISCORD_TOKEN: TOKEN, COMMAND_PREFIX: 'hai tu' }), ConfigError);
  });

  it('từ chối COOLDOWN_SECONDS âm', () => {
    assert.throws(() => fromEnv({ DISCORD_TOKEN: TOKEN, COOLDOWN_SECONDS: '-1' }), ConfigError);
  });

  it('đối tượng cấu hình là bất biến', () => {
    const config = fromEnv({ DISCORD_TOKEN: TOKEN });
    assert.throws(() => {
      config.token = 'khac';
    }, TypeError);
  });
});

describe('redactConfig', () => {
  it('che token', () => {
    const redacted = redactConfig(
      fromEnv({ DISCORD_TOKEN: TOKEN, GITHUB_TOKEN: 'github_pat_1234567890abcdef' }),
    );
    assert.equal(redacted.token, '***' + TOKEN.slice(-4));
    assert.ok(redacted.githubToken.startsWith('***'));
    assert.ok(!JSON.stringify(redacted).includes('github_pat_1234567890'));
  });
});

describe('loadDotenv', () => {
  it('đọc file .env và không ghi đè biến đã có', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dotenv-'));
    const file = join(dir, '.env');
    writeFileSync(
      file,
      ['# comment', '', "DISCORD_TOKEN='abc'", 'GUILD_ID="123"', 'export LOG_LEVEL=DEBUG', 'DISCORD_TOKEN=ghi-de'].join('\n'),
      'utf8',
    );
    const env = {};
    const loaded = loadDotenv(file, env);
    assert.equal(env.DISCORD_TOKEN, 'abc');
    assert.equal(env.GUILD_ID, '123');
    assert.equal(env.LOG_LEVEL, 'DEBUG');
    assert.deepEqual(loaded.sort(), ['DISCORD_TOKEN', 'GUILD_ID', 'LOG_LEVEL']);
  });

  it('file không tồn tại thì bỏ qua', () => {
    assert.deepEqual(loadDotenv('/khong/co/file/.env', {}), []);
  });
});
