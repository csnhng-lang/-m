#!/usr/bin/env node
/**
 * Xem trước embed mà bot sẽ gửi — không cần token, không cần kết nối Discord.
 *
 *   node scripts/preview.mjs          # in JSON embed + độ dài
 *   node scripts/preview.mjs --json   # chỉ in JSON
 */

import process from 'node:process';

import { buildProfileEmbed, embedLength } from '../src/embeds.js';

const NOW = Date.now();
const day = 24 * 60 * 60 * 1000;

export function demoTarget() {
  return {
    userId: '123456789012345678',
    username: 'csnhng',
    displayName: 'Cao Sỹ Nhân',
    nickname: 'nhan',
    isBot: false,
    createdAt: new Date(NOW - 1180 * day),
    joinedAt: new Date(NOW - 210 * day),
    guildName: 'Server Demo',
    roles: [
      { name: '@everyone', position: 0, color: 0, isDefault: true },
      { name: 'Admin', position: 9, color: 0xe67e22, isDefault: false },
      { name: 'Developer', position: 6, color: 0x3498db, isDefault: false },
      { name: 'Member', position: 2, color: 0x95a5a6, isDefault: false },
    ],
    boostSince: new Date(NOW - 45 * day),
    status: 'online',
    activities: ['Visual Studio Code', 'Đang code bot Discord'],
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    bannerUrl: null,
    publicFlags: ['ActiveDeveloper', 'PremiumEarlySupporter'],
    accentColor: 0xe67e22,
  };
}

export function demoProfile() {
  const accounts = [
    {
      type: 'github',
      handle: 'csnhng-lang',
      label: 'GitHub chính',
      url: 'https://github.com/csnhng-lang',
      visibility: 'public',
      verified: true,
      note: '',
      addedAt: new Date(NOW - 120 * day).toISOString(),
    },
    {
      type: 'steam',
      handle: 'nhan_gaming',
      label: 'Steam',
      url: 'https://steamcommunity.com/id/nhan_gaming',
      visibility: 'public',
      verified: false,
      note: '',
      addedAt: new Date(NOW - 30 * day).toISOString(),
    },
    {
      type: 'riot',
      handle: 'Nhan#VN1',
      label: 'Riot (LMHT)',
      url: '',
      visibility: 'restricted',
      verified: false,
      note: 'Chỉ dùng khi xử lý tranh chấp',
      addedAt: new Date(NOW - 10 * day).toISOString(),
    },
    {
      type: 'email',
      handle: 'nhan@example.com',
      label: '',
      url: '',
      visibility: 'restricted',
      verified: true,
      note: '',
      addedAt: new Date(NOW - 10 * day).toISOString(),
    },
  ];
  return {
    userId: '123456789012345678',
    displayName: 'Nhân (dev chính)',
    notes: 'Đã xác minh danh tính qua video call. Ưu tiên liên hệ qua Discord.',
    accounts,
    updatedAt: new Date().toISOString(),
  };
}

export function demoGithub() {
  return {
    login: 'csnhng-lang',
    htmlUrl: 'https://github.com/csnhng-lang',
    name: 'Cao Sy Nhan',
    bio: 'Backend dev · thích bot Discord',
    location: 'Bắc Ninh, Việt Nam',
    company: '',
    publicRepos: 14,
    followers: 37,
    following: 12,
    createdAt: new Date(NOW - 1500 * day),
  };
}

function main() {
  const target = demoTarget();
  const profile = demoProfile();
  const github = demoGithub();

  const publicEmbed = buildProfileEmbed(target, profile, {
    isStaff: false,
    githubProfiles: { [github.login]: github },
    requestedBy: 'Minh Anh',
    showPrivate: false,
  });
  const staffEmbed = buildProfileEmbed(target, profile, {
    isStaff: true,
    githubProfiles: { [github.login]: github },
    requestedBy: 'Admin',
    showPrivate: true,
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ public: publicEmbed.toJSON(), staff: staffEmbed.toJSON() }, null, 2));
    return 0;
  }

  for (const [label, embed] of [
    ['NGƯỜI THƯỜNG XEM', publicEmbed],
    ['STAFF XEM (riêng tư)', staffEmbed],
  ]) {
    console.log(`=== ${label} — ${embedLength(embed)} ký tự (giới hạn Discord: 6000) ===`);
    const data = embed.toJSON();
    console.log(data.title);
    for (const field of data.fields ?? []) {
      console.log(`\n[${field.name}]`);
      console.log(field.value);
    }
    console.log(`${data.footer ? `\n-- ${data.footer.text}` : ''}\n`);
  }
  return 0;
}

const isDirectRun = process.argv[1]?.endsWith('preview.mjs');
if (isDirectRun) process.exit(main());
