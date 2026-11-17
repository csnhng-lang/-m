/**
 * Định nghĩa lệnh slash + xử lý tương tác.
 * Tách khỏi index.js để test được phần schema lệnh mà không cần kết nối Discord.
 */

import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { createAccount, visibleAccounts } from './accounts.js';
import {
  DEFAULT_COLOR,
  buildErrorEmbed,
  buildHelpEmbed,
  buildSuccessEmbed,
} from './embeds.js';
import { renderProfile } from './render.js';
import { ValidationError, fitText, sanitizeText } from './text.js';

export const CONTEXT_MENU_NAME = 'Xem tài khoản';

function guildOnly(builder) {
  if (typeof builder.setContexts === 'function') {
    return builder.setContexts(InteractionContextType.Guild);
  }
  return builder.setDMPermission(false);
}

const VISIBILITY_CHOICES = [
  { name: 'public — ai cũng thấy', value: 'public' },
  { name: 'restricted — chỉ staff', value: 'restricted' },
];

/** Payload đăng ký lệnh (đã ở dạng JSON gửi lên Discord). */
export function commandData() {
  const whois = guildOnly(
    new SlashCommandBuilder()
      .setName('whois')
      .setDescription('Xem hồ sơ chi tiết của một người dùng')
      .addUserOption((option) =>
        option.setName('user').setDescription('Người dùng cần xem (chọn hoặc dán ID)').setRequired(true),
      )
      .addBooleanOption((option) =>
        option.setName('rieng_tu').setDescription('Chỉ mình bạn thấy kết quả'),
      ),
  ).toJSON();

  const help = guildOnly(
    new SlashCommandBuilder().setName('help').setDescription('Hướng dẫn dùng bot'),
  ).toJSON();

  const taikhoan = guildOnly(
    new SlashCommandBuilder()
      .setName('taikhoan')
      .setDescription('Quản lý danh sách tài khoản liên kết đã lưu')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('list')
          .setDescription('Liệt kê tài khoản đã lưu của một người')
          .addUserOption((option) =>
            option.setName('user').setDescription('Người dùng cần xem').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Thêm hoặc cập nhật một tài khoản liên kết')
          .addUserOption((option) =>
            option.setName('user').setDescription('Chủ sở hữu tài khoản').setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName('type')
              .setDescription('Loại tài khoản, ví dụ: github, steam, riot')
              .setRequired(true),
          )
          .addStringOption((option) =>
            option.setName('handle').setDescription('Tên đăng nhập / ID trên nền tảng đó').setRequired(true),
          )
          .addStringOption((option) => option.setName('label').setDescription('Nhãn hiển thị (tuỳ chọn)'))
          .addStringOption((option) =>
            option.setName('url').setDescription('Link tới hồ sơ (tuỳ chọn, phải là http/https)'),
          )
          .addStringOption((option) =>
            option
              .setName('visibility')
              .setDescription('public = ai cũng thấy, restricted = chỉ staff')
              .addChoices(...VISIBILITY_CHOICES),
          )
          .addBooleanOption((option) =>
            option.setName('verified').setDescription('Đã xác minh danh tính chưa'),
          )
          .addStringOption((option) => option.setName('note').setDescription('Ghi chú ngắn (tuỳ chọn)')),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Xoá một tài khoản liên kết')
          .addUserOption((option) =>
            option.setName('user').setDescription('Chủ sở hữu tài khoản').setRequired(true),
          )
          .addStringOption((option) =>
            option.setName('type').setDescription('Loại tài khoản').setRequired(true),
          )
          .addStringOption((option) =>
            option.setName('handle').setDescription('Tên đăng nhập / ID').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('note')
          .setDescription('Đặt ghi chú nội bộ cho một người')
          .addUserOption((option) =>
            option.setName('user').setDescription('Người dùng').setRequired(true),
          )
          .addStringOption((option) =>
            option.setName('note').setDescription('Ghi chú (để trống để xoá)'),
          ),
      ),
  ).toJSON();

  const contextMenu = guildOnly(
    new ContextMenuCommandBuilder().setName(CONTEXT_MENU_NAME).setType(ApplicationCommandType.User),
  ).toJSON();

  return [whois, help, taikhoan, contextMenu];
}

// --------------------------------------------------------------------------- //
// Xử lý tương tác
// --------------------------------------------------------------------------- //

function isEphemeral(interaction, config) {
  const opted = interaction.options?.getBoolean?.('rieng_tu');
  return Boolean(opted) || config.ephemeral;
}

async function sendError(interaction, message) {
  const embed = buildErrorEmbed(message);
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch {
    /* người dùng đã đóng tương tác — bỏ qua */
  }
}

async function handleWhois(interaction, ctx) {
  const target = interaction.options.getUser('user', true);
  const ephemeral = isEphemeral(interaction, ctx.config);
  await interaction.deferReply({ ephemeral });

  const embed = await renderProfile({
    target,
    guild: interaction.guild,
    invokerMember: interaction.member,
    invokerName: interaction.user.globalName ?? interaction.user.username,
    store: ctx.store,
    config: ctx.config,
    github: ctx.github,
    client: ctx.client,
    showPrivate: ephemeral, // dữ liệu nội bộ chỉ hiện khi chỉ người gọi thấy
  });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleHelp(interaction, ctx) {
  await interaction.reply({
    embeds: [
      buildHelpEmbed({
        prefix: ctx.config.commandPrefix,
        mentionTrigger: ctx.config.mentionTrigger,
        privacyEnabled: ctx.config.privacyRoleId !== null,
      }),
    ],
    ephemeral: true,
  });
}

function requireManageGuild(interaction) {
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
}

async function handleAccountList(interaction, ctx, target) {
  const profile = ctx.store.get(target.id);
  if (!profile || !profile.accounts.length) {
    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(`Chưa có tài khoản nào được lưu cho <@${target.id}>.`, {
          title: 'Danh sách trống',
        }),
      ],
    });
    return;
  }
  const lines = visibleAccounts(profile, { isStaff: true }).map((account) => {
    const flags = [];
    if (account.verified) flags.push('✅');
    if (account.visibility !== 'public') flags.push('🔒');
    const label = account.label ? ` · ${sanitizeText(account.label, { maxLen: 64 })}` : '';
    const mark = flags.length ? ` · ${flags.join(' ')}` : '';
    return `• \`${account.type}/${account.handle}\` — ${account.visibility}${mark}${label}`;
  });
  await interaction.editReply({
    embeds: [
      {
        color: DEFAULT_COLOR,
        title: `Tài khoản đã lưu của ${sanitizeText(target.displayName ?? target.username, { maxLen: 80 })}`,
        description: fitText(lines.join('\n'), 4000),
      },
    ],
  });
}

async function handleAccountAdd(interaction, ctx, target) {
  const options = interaction.options;
  let account;
  try {
    account = createAccount({
      type: options.getString('type', true),
      handle: options.getString('handle', true),
      label: options.getString('label') ?? '',
      url: options.getString('url') ?? '',
      visibility: options.getString('visibility') ?? 'public',
      verified: options.getBoolean('verified') ?? false,
      note: options.getString('note') ?? '',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      await sendError(interaction, sanitizeText(error.message, { maxLen: 300 }));
      return;
    }
    throw error;
  }

  const isNew = await ctx.store.upsertAccount(target.id, account);
  ctx.logger.info(
    `audit: ${interaction.user.username} (${interaction.user.id}) ` +
      `${isNew ? 'thêm' : 'cập nhật'} tài khoản ${account.type}/${account.handle} của ${target.id}`,
  );
  await interaction.editReply({
    embeds: [
      buildSuccessEmbed(
        `Đã ${isNew ? 'thêm' : 'cập nhật'} \`${account.type}/${sanitizeText(account.handle, { maxLen: 64, escape: false })}\` ` +
          `cho **${sanitizeText(target.displayName ?? target.username, { maxLen: 80 })}**.`,
      ),
    ],
  });
}

async function handleAccountRemove(interaction, ctx, target) {
  const type = interaction.options.getString('type', true);
  const handle = interaction.options.getString('handle', true);
  const removed = await ctx.store.removeAccount(target.id, type, handle);
  if (!removed) {
    await sendError(
      interaction,
      `Không tìm thấy \`${sanitizeText(type, { maxLen: 32 })}/${sanitizeText(handle, { maxLen: 64 })}\` ` +
        `của ${sanitizeText(target.displayName ?? target.username, { maxLen: 80 })}.`,
    );
    return;
  }
  ctx.logger.info(`audit: ${interaction.user.username} xoá tài khoản ${type}/${handle} của ${target.id}`);
  await interaction.editReply({
    embeds: [buildSuccessEmbed(`Đã xoá \`${sanitizeText(type, { maxLen: 32 })}/${sanitizeText(handle, { maxLen: 64 })}\`.`)],
  });
}

async function handleAccountNote(interaction, ctx, target) {
  const note = interaction.options.getString('note') ?? '';
  try {
    await ctx.store.setNotes(target.id, note);
  } catch (error) {
    if (error instanceof ValidationError) {
      await sendError(interaction, sanitizeText(error.message, { maxLen: 300 }));
      return;
    }
    throw error;
  }
  ctx.logger.info(`audit: ${interaction.user.username} đổi ghi chú của ${target.id}`);
  await interaction.editReply({
    embeds: [buildSuccessEmbed(note.trim() ? 'Đã lưu ghi chú.' : 'Đã xoá ghi chú.')],
  });
}

async function handleAccountCommand(interaction, ctx) {
  await interaction.deferReply({ ephemeral: true });
  const sub = interaction.options.getSubcommand(true);
  const target = interaction.options.getUser('user', true);

  if (sub === 'list') {
    await handleAccountList(interaction, ctx, target);
    return;
  }
  if (!requireManageGuild(interaction)) {
    await sendError(interaction, 'Bạn cần quyền **Quản lý server** để dùng lệnh này.');
    return;
  }
  if (sub === 'add') return handleAccountAdd(interaction, ctx, target);
  if (sub === 'remove') return handleAccountRemove(interaction, ctx, target);
  if (sub === 'note') return handleAccountNote(interaction, ctx, target);
  await sendError(interaction, `Lệnh con không hỗ trợ: ${sanitizeText(sub, { maxLen: 32 })}`);
}

async function handleContextMenu(interaction, ctx) {
  await interaction.deferReply({ ephemeral: ctx.config.ephemeral });
  const target = interaction.targetUser ?? interaction.targetMember?.user;
  const embed = await renderProfile({
    target,
    guild: interaction.guild,
    invokerMember: interaction.member,
    invokerName: interaction.user.globalName ?? interaction.user.username,
    store: ctx.store,
    config: ctx.config,
    github: ctx.github,
    client: ctx.client,
    showPrivate: false,
  });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

/** Điểm vào duy nhất cho mọi interaction. */
export async function handleInteraction(interaction, ctx) {
  try {
    if (interaction.isUserContextMenuCommand?.() && interaction.commandName === CONTEXT_MENU_NAME) {
      await handleContextMenu(interaction, ctx);
      return;
    }
    if (!interaction.isChatInputCommand?.()) return;

    switch (interaction.commandName) {
      case 'whois':
        await handleWhois(interaction, ctx);
        return;
      case 'help':
        await handleHelp(interaction, ctx);
        return;
      case 'taikhoan':
        await handleAccountCommand(interaction, ctx);
        return;
      default:
        ctx.logger.warning(`Lệnh không xác định: ${interaction.commandName}`);
    }
  } catch (error) {
    ctx.logger.error(`Lỗi xử lý tương tác: ${error.stack ?? error}`);
    await sendError(interaction, 'Có lỗi khi xử lý. Xem log của bot để biết chi tiết.');
  }
}
