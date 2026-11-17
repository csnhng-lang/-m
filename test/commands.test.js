import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApplicationCommandType, PermissionFlagsBits } from 'discord.js';

import { CONTEXT_MENU_NAME, commandData } from '../src/commands.js';
import { buildIntents, matchesPrefix } from '../src/index.js';

const data = commandData();
const byName = (name) => data.find((command) => command.name === name);

describe('commandData', () => {
  it('có đủ 4 lệnh', () => {
    assert.deepEqual(
      data.map((command) => command.name).sort(),
      ['help', 'taikhoan', 'whois', CONTEXT_MENU_NAME].sort(),
    );
  });

  it('mọi lệnh chat đều guild-only (contexts = [Guild])', () => {
    for (const command of data.filter((item) => item.type === ApplicationCommandType.ChatInput)) {
      assert.deepEqual(command.contexts, [0], `/${command.name} phải là guild-only`);
      assert.ok(command.description, `/${command.name} thiếu description`);
      assert.ok(command.description.length <= 100);
    }
  });

  it('/whois có option user bắt buộc + rieng_tu tuỳ chọn', () => {
    const options = byName('whois').options;
    const user = options.find((option) => option.name === 'user');
    const riengTu = options.find((option) => option.name === 'rieng_tu');
    assert.equal(user.required, true);
    assert.equal(user.type, 6); // USER
    assert.equal(riengTu.required, false);
    assert.equal(riengTu.type, 5); // BOOLEAN
  });

  it('/taikhoan có 4 lệnh con và gate quyền Quản lý server', () => {
    const command = byName('taikhoan');
    assert.deepEqual(
      command.options.map((option) => option.name),
      ['list', 'add', 'remove', 'note'],
    );
    assert.equal(Number(command.default_member_permissions), Number(PermissionFlagsBits.ManageGuild));
  });

  it('/taikhoan add có đủ option cần thiết', () => {
    const add = byName('taikhoan').options.find((option) => option.name === 'add');
    const names = add.options.map((option) => option.name);
    assert.deepEqual(names, [
      'user',
      'type',
      'handle',
      'label',
      'url',
      'visibility',
      'verified',
      'note',
    ]);
    const visibility = add.options.find((option) => option.name === 'visibility');
    assert.deepEqual(
      visibility.choices.map((choice) => choice.value),
      ['public', 'restricted'],
    );
  });

  it('menu chuột phải là loại USER', () => {
    const menu = byName(CONTEXT_MENU_NAME);
    assert.equal(menu.type, ApplicationCommandType.User);
    assert.deepEqual(menu.contexts, [0]);
  });

  it('JSON gửi lên Discord hợp lệ (serialize được)', () => {
    const encoded = JSON.stringify(data);
    assert.ok(encoded.includes('whois'));
    for (const command of data) {
      assert.equal(typeof command.name, 'string');
      assert.ok(command.name.length > 0 && command.name.length <= 32);
      if (command.type === ApplicationCommandType.ChatInput) {
        // Tên lệnh slash chỉ được gồm chữ thường, số, gạch dưới/gạch ngang.
        assert.match(command.name, /^[a-z0-9_-]+$/);
      }
    }
  });
});

describe('matchesPrefix', () => {
  const cases = [
    ['!info @user', true],
    ['!info', true],
    ['!info\n<@123>', true],
    ['!info <@!123>', true],
    ['!information @user', false],
    ['!infooo', false],
    ['hello !info @user', false],
    ['', false],
  ];
  for (const [content, expected] of cases) {
    it(`"${content}" -> ${expected}`, () => {
      assert.equal(matchesPrefix(content, '!info'), expected);
    });
  }
});

describe('buildIntents', () => {
  const base = { mentionTrigger: 'bot', presenceIntent: false };

  it('bật MessageContent khi cần đọc mention', () => {
    const intents = buildIntents(base);
    assert.ok(intents.includes(32768)); // MessageContent
  });

  it('tắt MessageContent khi MENTION_TRIGGER=off', () => {
    const intents = buildIntents({ ...base, mentionTrigger: 'off' });
    assert.ok(!intents.includes(32768));
  });

  it('chỉ bật presence khi được yêu cầu', () => {
    assert.ok(!buildIntents(base).includes(256)); // GuildPresences
    assert.ok(buildIntents({ ...base, presenceIntent: true }).includes(256));
  });
});
