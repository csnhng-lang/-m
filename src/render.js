/**
 * Ghép dữ liệu Discord + store + GitHub thành một embed hồ sơ hoàn chỉnh.
 */

import { PermissionFlagsBits } from 'discord.js';

import { visibleAccounts } from './accounts.js';
import { buildProfileEmbed } from './embeds.js';
import { GitHubError } from './github.js';
import { snapshotFromUser } from './snapshot.js';

export const MAX_TARGETS_PER_MESSAGE = 3;
export const GITHUB_LOOKUPS_PER_REPLY = 3;

/** Người xem có quyền thấy dữ liệu nội bộ (ghi chú, tài khoản restricted)? */
export function isStaffMember(member, config) {
  if (!member) return false;
  const permissions = member.permissions;
  if (permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  if (config.privacyRoleId && member.roles?.cache?.has?.(String(config.privacyRoleId))) return true;
  return false;
}

async function lookupGithub(github, accounts) {
  const profiles = {};
  const errors = {};
  if (!github) return { profiles, errors };

  const logins = accounts
    .filter((account) => account.type === 'github' && account.handle)
    .slice(0, GITHUB_LOOKUPS_PER_REPLY)
    .map((account) => account.handle);
  if (!logins.length) return { profiles, errors };

  const results = await Promise.allSettled(logins.map((login) => github.fetch(login)));
  results.forEach((result, index) => {
    const login = logins[index];
    if (result.status === 'rejected') {
      const reason = result.reason;
      errors[login] =
        reason instanceof GitHubError ? reason.message : 'không tra cứu được';
    } else if (result.value === null) {
      errors[login] = 'không tìm thấy người dùng GitHub này';
    } else {
      profiles[login] = result.value;
    }
  });
  return { profiles, errors };
}

/**
 * @returns {Promise<import('discord.js').EmbedBuilder>}
 */
export async function renderProfile({
  target,
  guild,
  invokerMember = null,
  invokerName = null,
  store,
  config,
  github = null,
  client,
  showPrivate = true,
}) {
  const snapshot = await snapshotFromUser({
    target,
    guild,
    client,
    presenceIntent: config.presenceIntent,
  });
  const profile = store.get(target.id);
  const isStaff = isStaffMember(invokerMember, config);
  const accounts = visibleAccounts(profile, { isStaff: isStaff && showPrivate });
  const { profiles, errors } = await lookupGithub(github, accounts);

  return buildProfileEmbed(snapshot, profile, {
    isStaff,
    githubProfiles: profiles,
    githubErrors: errors,
    requestedBy: invokerName,
    showPrivate,
  });
}
