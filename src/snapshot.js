/**
 * Trích dữ liệu cần thiết từ đối tượng discord.js thành object thuần.
 * Nhờ lớp này, phần dựng embed (src/embeds.js) test được mà không cần kết nối Discord.
 */

import { ActivityType } from 'discord.js';

export const STATUS_NAMES = {
  0: 'online',
  1: 'idle',
  2: 'dnd',
  3: 'offline',
  4: 'invisible',
};

function activityLabel(activity) {
  if (!activity) return '';
  if (activity.type === ActivityType.Custom) {
    return (activity.state || activity.name || '').trim();
  }
  if (activity.name === 'Spotify') {
    const parts = [activity.details, activity.state].filter(Boolean).join(' — ');
    return parts ? `🎵 Spotify — ${parts}` : '🎵 Spotify';
  }
  return (activity.name || '').trim();
}

/**
 * @param {object} params
 * @param {import('discord.js').User} params.target  user/member được mention
 * @param {import('discord.js').Guild|null} params.guild
 * @param {import('discord.js').Client} params.client
 * @param {boolean} params.presenceIntent
 */
export async function snapshotFromUser({ target, guild, client, presenceIntent }) {
  let member = guild?.members?.cache?.get(target.id) ?? null;
  if (guild && !member) {
    try {
      member = await guild.members.fetch(target.id);
    } catch {
      member = null;
    }
  }

  let user = member?.user ?? target;
  if (!member) {
    try {
      user = await client.users.fetch(target.id);
    } catch {
      user = target;
    }
  }

  const roles = member
    ? [...member.roles.cache.values()].map((role) => ({
        name: role.name,
        position: role.rawPosition,
        color: role.color || 0,
        isDefault: role.id === member.guild.id,
      }))
    : [];
  roles.sort((a, b) => b.position - a.position);

  const activities = [];
  let status = null;
  if (presenceIntent && member?.presence) {
    status = STATUS_NAMES[member.presence.status] ?? member.presence.status ?? null;
    for (const activity of member.presence.activities.slice(0, 3)) {
      const label = activityLabel(activity);
      if (label) activities.push(label);
    }
  }

  let publicFlags = [];
  try {
    publicFlags = user.flags?.toArray?.() ?? [];
  } catch {
    publicFlags = [];
  }

  let accentColor = null;
  if (user.hexAccentColor) {
    const parsed = Number.parseInt(user.hexAccentColor.replace('#', ''), 16);
    accentColor = Number.isNaN(parsed) ? null : parsed;
  }

  return {
    userId: user.id,
    username: user.username,
    displayName: member?.displayName ?? user.globalName ?? user.username,
    nickname: member?.nickname ?? null,
    isBot: Boolean(user.bot),
    createdAt: user.createdAt ?? null,
    joinedAt: member?.joinedAt ?? null,
    guildName: guild?.name ?? null,
    roles,
    boostSince: member?.premiumSince ?? null,
    status,
    activities,
    avatarUrl: member?.displayAvatarURL({ size: 256 }) ?? user.displayAvatarURL({ size: 256 }),
    bannerUrl: user.bannerURL?.({ size: 600 }) ?? null,
    publicFlags,
    accentColor,
  };
}
