/**
 * Dựng embed từ dữ liệu thuần — tương đương `embeds.py`.
 * Tách khỏi phần kết nối Discord để test được độc lập.
 */

import { EmbedBuilder } from 'discord.js';

import { visibleAccounts } from './accounts.js';
import {
  fitText,
  formatTimestampPair,
  humanDelta,
  plainText,
  sanitizeText,
} from './text.js';

export const DEFAULT_COLOR = 0x5865f2;
export const OK_COLOR = 0x57f287;
export const ERROR_COLOR = 0xed4245;

export const FIELD_VALUE_LIMIT = 1024;
export const FIELD_NAME_LIMIT = 256;
export const DESCRIPTION_LIMIT = 4096;
export const EMBED_TOTAL_LIMIT = 5800; // Discord cho 6000, chừa biên
const MAX_FIELD_NOTE = 480;

export const STATUS_LABELS = {
  online: '🟢 Đang online',
  idle: '🌙 Treo máy (idle)',
  dnd: '⛔ Không làm phiền',
  offline: '⚫ Offline',
  invisible: '⚫ Ẩn (invisible)',
};

export const FLAG_LABELS = {
  Staff: 'Nhân viên Discord',
  Partner: 'Đối tác Discord',
  HypeSquad: 'HypeSquad Events',
  BugHunterLevel1: 'Bug Hunter',
  BugHunterLevel2: 'Bug Hunter Lv2',
  HypeSquadOnlineHouse1: 'HypeSquad Bravery',
  HypeSquadOnlineHouse2: 'HypeSquad Brilliance',
  HypeSquadOnlineHouse3: 'HypeSquad Balance',
  PremiumEarlySupporter: 'Early Supporter',
  VerifiedBot: 'Bot đã xác minh',
  VerifiedDeveloper: 'Nhà phát triển bot đã xác minh',
  ActiveDeveloper: 'Active Developer',
  System: 'System',
};

export const ACCOUNT_TYPE_LABELS = {
  github: 'GitHub',
  gitlab: 'GitLab',
  steam: 'Steam',
  riot: 'Riot Games',
  roblox: 'Roblox',
  minecraft: 'Minecraft',
  epic: 'Epic Games',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  twitter: 'X / Twitter',
  discord: 'Discord khác',
  email: 'Email',
  website: 'Website',
  khac: 'Khác',
};

function safeUrl(url) {
  return String(url).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
}

function inlineCode(value, limit = 64) {
  const cleaned = sanitizeText(value, { maxLen: limit, escape: false }).replace(/`/g, "'");
  return `\`${cleaned}\``;
}

function typeLabel(type) {
  const key = String(type).toLowerCase();
  return ACCOUNT_TYPE_LABELS[key] ?? (key.length <= 4 ? key.toUpperCase() : key);
}

/** Một dòng mô tả tài khoản liên kết (đã escape mọi dữ liệu người dùng nhập). */
export function accountLine(account) {
  const label = sanitizeText(account.label || account.handle, { maxLen: 64 });
  const handle = account.label ? sanitizeText(account.handle, { maxLen: 64 }) : '';
  let head = `**${label}**${handle ? ` · ${inlineCode(account.handle)}` : ''}`;
  if (account.url) head = `[${head}](${safeUrl(account.url)})`;

  const marks = [`__${typeLabel(account.type)}__`];
  if (account.verified) marks.push('✅ đã xác minh');
  if (account.visibility !== 'public') marks.push('🔒 nội bộ');

  let line = `• ${head} — ${marks.join(' · ')}`;
  if (account.note) {
    line += `\n   ↳ ${sanitizeText(account.note, { maxLen: 200, singleLine: false })}`;
  }
  if (account.addedAt) {
    line += `\n   ↳ thêm ${humanDelta(new Date(account.addedAt))} trước`;
  }
  return line;
}

export function accountLines(accounts, { limit = FIELD_VALUE_LIMIT } = {}) {
  if (!accounts.length) return '_Chưa có tài khoản liên kết nào được lưu._';
  const lines = [];
  let used = 0;
  accounts.forEach((account, index) => {
    const line = accountLine(account);
    const remaining = accounts.length - index - 1;
    if (used + line.length > limit - 40) {
      lines.push(`_… còn ${remaining + 1} tài khoản nữa (xem bằng lệnh /taikhoan list)._`);
      return;
    }
    lines.push(line);
    used += line.length + 1;
  });
  return fitText(lines.join('\n'), limit);
}

export function githubLines(profiles = {}, errors = {}) {
  const lines = [];
  for (const login of Object.keys(profiles).sort()) {
    const profile = profiles[login];
    const bits = [`[**${sanitizeText(profile.login, { maxLen: 40 })}**](${safeUrl(profile.htmlUrl)})`];
    if (profile.name) bits.push(sanitizeText(profile.name, { maxLen: 60 }));
    bits.push(`${profile.publicRepos} repo · ${profile.followers} follower`);
    let line = `• ${bits.join(' — ')}`;
    const extra = [];
    if (profile.bio) extra.push(`_${sanitizeText(profile.bio, { maxLen: 160, singleLine: false })}_`);
    const place = [profile.company, profile.location].filter(Boolean).join(' · ');
    if (place) extra.push(sanitizeText(place, { maxLen: 120 }));
    if (profile.createdAt) {
      extra.push(`tạo tài khoản ${humanDelta(profile.createdAt)} trước`);
    }
    if (extra.length) line += `\n   ↳ ${extra.join('\n   ↳ ')}`;
    lines.push(line);
  }
  for (const login of Object.keys(errors).sort()) {
    lines.push(
      `• **${sanitizeText(login, { maxLen: 40 })}** — ⚠️ ${sanitizeText(errors[login], { maxLen: 120 })}`,
    );
  }
  return fitText(lines.join('\n'), FIELD_VALUE_LIMIT);
}

class Budget {
  constructor(limit = EMBED_TOTAL_LIMIT) {
    this.limit = limit;
    this.used = 0;
  }

  take(size) {
    const granted = Math.min(size, Math.max(0, this.limit - this.used));
    this.used += granted;
    return granted;
  }
}

/** Tổng số ký tự Discord tính cho một embed (dùng để test giới hạn 6000). */
export function embedLength(embed) {
  const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
  let total = 0;
  total += data.title?.length ?? 0;
  total += data.description?.length ?? 0;
  total += data.footer?.text?.length ?? 0;
  total += data.author?.name?.length ?? 0;
  for (const field of data.fields ?? []) {
    total += field.name.length + field.value.length;
  }
  return total;
}

function topRole(roles = []) {
  let top = null;
  for (const role of roles) {
    if (role.isDefault) continue;
    if (!top || role.position > top.position) top = role;
  }
  return top;
}

function roleNames(roles = [], limit = 12) {
  return roles
    .filter((role) => !role.isDefault)
    .sort((a, b) => b.position - a.position)
    .slice(0, limit)
    .map((role) => role.name);
}

/**
 * Embed hồ sơ người dùng.
 * @param {object} snapshot  dữ liệu Discord đã trích (xem src/snapshot.js)
 * @param {object|null} profile  hồ sơ trong store
 */
export function buildProfileEmbed(
  snapshot,
  profile,
  {
    isStaff = false,
    githubProfiles = {},
    githubErrors = {},
    requestedBy = null,
    showPrivate = true,
  } = {},
) {
  const staffView = isStaff && showPrivate;
  const budget = new Budget();
  const top = topRole(snapshot.roles);

  const titleName =
    sanitizeText(snapshot.displayName || snapshot.username, { maxLen: 80 }) || 'Người dùng';
  const title = fitText(`Hồ sơ: ${titleName}`, FIELD_NAME_LIMIT);
  budget.take(title.length);

  const embed = new EmbedBuilder()
    .setColor(top?.color || snapshot.accentColor || DEFAULT_COLOR)
    .setTitle(title)
    .setTimestamp(new Date());
  if (snapshot.avatarUrl) embed.setThumbnail(snapshot.avatarUrl);

  // --- Tài khoản Discord ------------------------------------------------- //
  const identity = [
    `**ID:** \`${snapshot.userId}\``,
    `**Username:** ${inlineCode(snapshot.username)}`,
  ];
  if (snapshot.nickname && snapshot.nickname !== snapshot.displayName) {
    identity.push(`**Biệt danh (server):** ${sanitizeText(snapshot.nickname, { maxLen: 64 })}`);
  }
  if (snapshot.isBot) identity.push('**Loại:** 🤖 Bot');
  if (snapshot.createdAt) {
    identity.push(`**Tạo tài khoản:** ${formatTimestampPair(snapshot.createdAt)}`);
  }
  if (snapshot.joinedAt) {
    identity.push(`**Vào server:** ${formatTimestampPair(snapshot.joinedAt)}`);
  } else if (snapshot.guildName) {
    identity.push('**Vào server:** _không có trong server này_');
  }
  if (snapshot.boostSince) {
    identity.push(`**Boost từ:** ${formatTimestampPair(snapshot.boostSince)}`);
  }
  if (snapshot.status) {
    identity.push(`**Trạng thái:** ${STATUS_LABELS[snapshot.status] ?? snapshot.status}`);
  }
  if (snapshot.activities?.length) {
    identity.push(
      `**Hoạt động:** ${snapshot.activities
        .slice(0, 3)
        .map((a) => sanitizeText(a, { maxLen: 40 }))
        .join(', ')}`,
    );
  }
  if (snapshot.publicFlags?.length) {
    identity.push(
      `**Huy hiệu:** ${snapshot.publicFlags
        .slice(0, 6)
        .map((flag) => FLAG_LABELS[flag] ?? flag)
        .join(', ')}`,
    );
  }

  const identityText = identity.join('\n');
  embed.addFields({
    name: '👤 Tài khoản Discord',
    value: fitText(identityText, Math.min(FIELD_VALUE_LIMIT, budget.take(identityText.length))) || '—',
    inline: false,
  });

  // --- Vai trò ----------------------------------------------------------- //
  const names = roleNames(snapshot.roles, 15);
  if (names.length || top) {
    const lines = [];
    if (top) lines.push(`**Vai trò cao nhất:** ${sanitizeText(top.name, { maxLen: 64 })}`);
    if (names.length) {
      const totalRoles = snapshot.roles.filter((role) => !role.isDefault).length;
      lines.push(
        `**Vai trò (${totalRoles}):** ${names.map((name) => sanitizeText(name, { maxLen: 40 })).join(', ')}`,
      );
      if (totalRoles > names.length) {
        lines.push(`_… và ${totalRoles - names.length} vai trò khác_`);
      }
    }
    const text = lines.join('\n');
    const granted = budget.take(text.length);
    if (granted >= 10) {
      embed.addFields({ name: '🎭 Vai trò', value: fitText(text, FIELD_VALUE_LIMIT), inline: false });
    }
  }

  // --- Tài khoản liên kết ------------------------------------------------ //
  const accounts = profile ? visibleAccounts(profile, { isStaff: staffView }) : [];
  let accountsText = accountLines(accounts);
  if (profile && isStaff && !showPrivate) {
    const hidden = profile.accounts.length - accounts.length;
    if (hidden > 0) accountsText += `\n_🔒 ${hidden} tài khoản nội bộ bị ẩn ở ngữ cảnh này._`;
  }
  const grantedAccounts = budget.take(accountsText.length);
  if (grantedAccounts < 20) accountsText = '_Không đủ chỗ hiển thị trong embed._';
  embed.addFields({
    name: '🔗 Tài khoản liên kết',
    value: fitText(accountsText, FIELD_VALUE_LIMIT),
    inline: false,
  });

  // --- Ghi chú nội bộ ---------------------------------------------------- //
  if (profile?.notes && staffView) {
    const escaped = sanitizeText(profile.notes, { maxLen: MAX_FIELD_NOTE, singleLine: false });
    const notes = fitText(escaped, Math.min(FIELD_VALUE_LIMIT, budget.take(escaped.length)));
    if (notes.trim()) {
      embed.addFields({ name: '📝 Ghi chú nội bộ', value: notes, inline: false });
    }
  }

  // --- GitHub công khai -------------------------------------------------- //
  if (Object.keys(githubProfiles).length || Object.keys(githubErrors).length) {
    const text = githubLines(githubProfiles, githubErrors);
    if (budget.take(text.length) >= 20) {
      embed.addFields({ name: '🐙 GitHub (công khai)', value: text, inline: false });
    }
  }

  // --- Footer ------------------------------------------------------------ //
  if (profile?.updatedAt) {
    const prefix = requestedBy ? `Yêu cầu bởi ${requestedBy} · ` : '';
    embed.setFooter({
      text: fitText(
        `${prefix}Dữ liệu nội bộ cập nhật ${humanDelta(new Date(profile.updatedAt))} trước`,
        200,
      ),
    });
  } else if (requestedBy) {
    embed.setFooter({ text: fitText(`Yêu cầu bởi ${requestedBy}`, 200) });
  }

  return embed;
}

/** Embed lỗi — `message` phải là văn bản an toàn (escape trước nếu từ người dùng). */
export function buildErrorEmbed(message, { title = 'Không xử lý được' } = {}) {
  return new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle(plainText(title, 256) || 'Lỗi')
    .setDescription(plainText(message, DESCRIPTION_LIMIT));
}

export function buildSuccessEmbed(message, { title = 'Xong' } = {}) {
  return new EmbedBuilder()
    .setColor(OK_COLOR)
    .setTitle(plainText(title, 256) || 'Xong')
    .setDescription(plainText(message, DESCRIPTION_LIMIT));
}

export function buildHelpEmbed({ prefix, mentionTrigger = 'bot', privacyEnabled = false }) {
  const triggers = {
    bot: `Mention bot rồi mention người cần xem: \`@Bot @user\`\nHoặc \`${prefix} @user\``,
    any: `Mention bất kỳ ai: \`@user\` (bot sẽ trả lời)\nHoặc \`${prefix} @user\``,
    off: `Đã tắt chế độ mention. Dùng \`${prefix} @user\` hoặc \`/whois\`.`,
  };
  const embed = new EmbedBuilder()
    .setColor(DEFAULT_COLOR)
    .setTitle('Bot giới thiệu tài khoản')
    .setDescription(
      'Mention một người để xem hồ sơ chi tiết, hoặc dùng lệnh bên dưới.\n' +
        'Bot chỉ đọc dữ liệu công khai của Discord và dữ liệu do admin của server nhập vào — ' +
        'không truy cập tài khoản riêng tư của ai.',
    )
    .addFields({ name: 'Cách dùng', value: triggers[mentionTrigger] ?? triggers.bot, inline: false })
    .addFields({
      name: 'Lệnh slash',
      value:
        '`/whois user:@ai_do` — xem hồ sơ\n' +
        '`/taikhoan list user:@ai_do` — liệt kê tài khoản đã lưu\n' +
        '`/taikhoan add` `/taikhoan remove` `/taikhoan note` — quản lý (cần quyền Quản lý server)\n' +
        '`/help` — trợ giúp này',
      inline: false,
    })
    .setFooter({ text: 'Dữ liệu do server tự quản lý · không chia sẻ ra ngoài' });
  if (privacyEnabled) {
    embed.addFields({
      name: 'Riêng tư',
      value: 'Mục `🔒 nội bộ` chỉ hiển thị với người có role được cấu hình (`PRIVACY_ROLE_ID`).',
      inline: false,
    });
  }
  return embed;
}
