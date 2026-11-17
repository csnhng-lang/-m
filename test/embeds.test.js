import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAccount } from '../src/accounts.js';
import {
  FIELD_NAME_LIMIT,
  FIELD_VALUE_LIMIT,
  buildErrorEmbed,
  buildHelpEmbed,
  buildProfileEmbed,
  embedLength,
} from '../src/embeds.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function makeTarget(overrides = {}) {
  return {
    userId: '123456789012345678',
    username: 'csnhng',
    displayName: 'Cao Sỹ Nhân',
    nickname: 'nhan',
    isBot: false,
    createdAt: new Date(NOW - 900 * DAY),
    joinedAt: new Date(NOW - 120 * DAY),
    guildName: 'Test Guild',
    roles: [
      { name: '@everyone', position: 0, color: 0, isDefault: true },
      { name: 'Admin', position: 7, color: 0x00ff00, isDefault: false },
      { name: 'Dev', position: 3, color: 0x0000ff, isDefault: false },
    ],
    boostSince: new Date(NOW - 10 * DAY),
    status: 'online',
    activities: ['Visual Studio Code'],
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    bannerUrl: null,
    publicFlags: ['ActiveDeveloper', 'PremiumEarlySupporter'],
    accentColor: 0x123456,
    ...overrides,
  };
}

function makeProfile(accountCount = 3) {
  const accounts = [];
  for (let i = 0; i < accountCount; i += 1) {
    accounts.push(
      createAccount({
        type: i % 2 === 0 ? 'github' : 'steam',
        handle: `user${i}`,
        label: `Tài khoản ${i}`,
        url: `https://example.com/${i}`,
        visibility: i === accountCount - 1 ? 'restricted' : 'public',
      }),
    );
  }
  return {
    userId: '123456789012345678',
    displayName: '',
    notes: 'Ghi chú nội bộ: đã xác minh CCCD.',
    accounts,
    updatedAt: new Date().toISOString(),
  };
}

const fieldNames = (embed) => (embed.toJSON().fields ?? []).map((field) => field.name);
const fieldValue = (embed, needle) =>
  (embed.toJSON().fields ?? []).find((field) => field.name.includes(needle))?.value ?? '';

describe('buildProfileEmbed', () => {
  it('có đủ các mục cơ bản', () => {
    const embed = buildProfileEmbed(makeTarget(), makeProfile(), {});
    const names = fieldNames(embed);
    assert.ok(names.includes('👤 Tài khoản Discord'));
    assert.ok(names.includes('🔗 Tài khoản liên kết'));
    assert.ok(embed.toJSON().title.startsWith('Hồ sơ:'));
  });

  it('tài khoản restricted bị ẩn với người thường', () => {
    const embed = buildProfileEmbed(makeTarget(), makeProfile(3), { isStaff: false });
    const value = fieldValue(embed, 'liên kết');
    assert.ok(!value.includes('user2'));
    assert.ok(value.includes('user0'));
  });

  it('staff xem riêng tư thấy tài khoản restricted', () => {
    const embed = buildProfileEmbed(makeTarget(), makeProfile(3), {
      isStaff: true,
      showPrivate: true,
    });
    assert.ok(fieldValue(embed, 'liên kết').includes('user2'));
  });

  it('staff xem công khai: ẩn restricted kèm ghi chú', () => {
    const embed = buildProfileEmbed(makeTarget(), makeProfile(3), {
      isStaff: true,
      showPrivate: false,
    });
    const value = fieldValue(embed, 'liên kết');
    assert.ok(!value.includes('user2'));
    assert.ok(value.includes('bị ẩn'));
  });

  it('ghi chú chỉ hiện với staff', () => {
    const publicEmbed = buildProfileEmbed(makeTarget(), makeProfile(), { isStaff: false });
    const staffEmbed = buildProfileEmbed(makeTarget(), makeProfile(), { isStaff: true });
    assert.ok(!fieldNames(publicEmbed).some((name) => name.includes('Ghi chú')));
    assert.ok(fieldNames(staffEmbed).some((name) => name.includes('Ghi chú')));
  });

  it('không có hồ sơ vẫn render', () => {
    const embed = buildProfileEmbed(makeTarget(), null, {});
    assert.match(fieldValue(embed, 'liên kết'), /Chưa có tài khoản/);
  });

  it('người không ở trong server', () => {
    const embed = buildProfileEmbed(
      makeTarget({ joinedAt: null, roles: [], guildName: 'G' }),
      null,
      {},
    );
    assert.ok(fieldNames(embed).includes('👤 Tài khoản Discord'));
    assert.ok(!fieldNames(embed).includes('🎭 Vai trò'));
  });

  it('màu lấy theo vai trò cao nhất', () => {
    const embed = buildProfileEmbed(makeTarget(), null, {});
    assert.equal(embed.toJSON().color, 0x00ff00);
  });

  it('vô hiệu hoá markdown do người dùng nhập', () => {
    const target = makeTarget({ displayName: '@everyone **hacked**', nickname: null });
    const profile = {
      userId: '1',
      displayName: '',
      notes: '',
      accounts: [createAccount({ type: 'github', handle: '**x**' })],
      updatedAt: null,
    };
    const embed = buildProfileEmbed(target, profile, {});
    assert.ok(!embed.toJSON().title.includes('**hacked**'));
    assert.ok(fieldValue(embed, 'liên kết').includes('\\*\\*x\\*\\*'));
  });

  it('hiện phần GitHub công khai', () => {
    const profile = makeProfile(1);
    const embed = buildProfileEmbed(makeTarget(), profile, {
      githubProfiles: {
        user0: {
          login: 'user0',
          htmlUrl: 'https://github.com/user0',
          name: 'User Zero',
          bio: 'dev',
          company: '',
          location: '',
          publicRepos: 12,
          followers: 34,
          following: 1,
          createdAt: new Date(NOW - 400 * DAY),
        },
      },
    });
    const value = fieldValue(embed, 'GitHub');
    assert.ok(value.includes('12 repo'));
    assert.ok(value.includes('34 follower'));
  });

  it('báo lỗi GitHub mà không sập', () => {
    const embed = buildProfileEmbed(makeTarget(), makeProfile(1), {
      githubErrors: { user0: 'Hết quota GitHub API' },
    });
    assert.ok(fieldValue(embed, 'GitHub').includes('quota'));
  });

  it('footer ghi người yêu cầu', () => {
    const embed = buildProfileEmbed(makeTarget(), makeProfile(), { requestedBy: 'Admin' });
    assert.ok(embed.toJSON().footer.text.includes('Admin'));
  });
});

describe('giới hạn của Discord', () => {
  function stressProfile() {
    const accounts = Array.from({ length: 40 }, (_, i) =>
      createAccount({
        type: 'github',
        handle: `very-long-handle-${i}-${'x'.repeat(20)}`,
        label: `Nhãn dài ${'y'.repeat(40)}`,
        url: `https://example.com/${i}`,
        note: `ghi chú ${'z'.repeat(120)}`,
      }),
    );
    return { userId: '1', displayName: '', notes: 'n'.repeat(500), accounts, updatedAt: null };
  }

  it('tổng độ dài <= 6000 và từng field <= giới hạn', () => {
    const target = makeTarget({
      roles: Array.from({ length: 60 }, (_, i) => ({
        name: `Vai trò rất dài ${i}${'a'.repeat(20)}`,
        position: i,
        color: 0,
        isDefault: false,
      })),
      activities: ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)],
      publicFlags: Array(10).fill('ActiveDeveloper'),
    });
    const embed = buildProfileEmbed(target, stressProfile(), { isStaff: true });
    const data = embed.toJSON();
    assert.ok(embedLength(embed) <= 6000, `embed quá dài: ${embedLength(embed)}`);
    for (const field of data.fields) {
      assert.ok(field.name.length <= FIELD_NAME_LIMIT, `tên field quá dài: ${field.name.length}`);
      assert.ok(field.value.length <= FIELD_VALUE_LIMIT, `giá trị field quá dài: ${field.value.length}`);
    }
  });
});

describe('embed phụ trợ', () => {
  it('cắt ngắn mô tả lỗi', () => {
    const embed = buildErrorEmbed('x'.repeat(5000));
    assert.ok(embed.toJSON().description.length <= 4096);
  });

  it('bỏ ký tự vô hình', () => {
    const embed = buildErrorEmbed('a\u200bb\u202ec');
    assert.ok(!embed.toJSON().description.includes('\u200b'));
  });

  it('help embed cho mọi chế độ mention', () => {
    for (const trigger of ['bot', 'any', 'off']) {
      const embed = buildHelpEmbed({ prefix: '!info', mentionTrigger: trigger });
      assert.ok(embed.toJSON().title);
      assert.ok(embedLength(embed) <= 6000);
    }
  });

  it('help embed có mục Riêng tư khi bật privacy role', () => {
    const embed = buildHelpEmbed({
      prefix: '!info',
      mentionTrigger: 'bot',
      privacyEnabled: true,
    });
    assert.ok(fieldNames(embed).includes('Riêng tư'));
  });
});
