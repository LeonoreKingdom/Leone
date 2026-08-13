const { PermissionFlagsBits, SnowflakeUtil } = require('discord.js');

const {
  error,
  highestRole,
  loadContext,
  rolePosition,
} = require('./server-admin-service');

function requirePermission(context, permission, label) {
  if (!context.permissions.has(permission)) {
    throw error('BOT_PERMISSION_REQUIRED', `Leone needs ${label} in Discord.`, 409);
  }
}

async function targetMember({ context, restClient, userId }) {
  try {
    const member = await restClient.getGuildMember(context.bundle.guild.id, userId);
    if (userId === context.bundle.guild.owner_id) throw error('OWNER_TARGET_FORBIDDEN', 'The guild owner cannot be moderated.');
    const highest = highestRole(context.bundle.roles, member.roles ?? []);
    if (!context.botRole || (highest && rolePosition(highest) >= rolePosition(context.botRole))) {
      throw error('MEMBER_HIERARCHY_BLOCKED', 'Leone cannot moderate a member at or above its highest role.', 409);
    }
    return member;
  } catch (cause) {
    if (cause.code) throw cause;
    if (cause.status === 404) throw error('MEMBER_NOT_FOUND', 'The target is not a current member of this guild.', 404);
    throw cause;
  }
}

function snowflakeAgeSeconds(messageId) {
  try {
    return Math.floor((Date.now() - Number(SnowflakeUtil.timestampFrom(messageId))) / 1000);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function actionLabel(action) {
  return action === 'untimeout' ? 'remove timeout' : action;
}

async function executeModeration({
  guildId,
  actorUserId,
  restClient,
  repository,
  audit,
  input,
  settings = {},
}) {
  const context = await loadContext({ guildId, restClient });
  const action = input.action;
  const targetUserId = input.targetUserId ?? actorUserId;
  const reason = input.reason.trim();
  let member = null;

  if (['timeout', 'untimeout', 'kick', 'ban', 'warn'].includes(action)) {
    member = await targetMember({ context, restClient, userId: targetUserId });
  }
  if (action === 'timeout' || action === 'untimeout') requirePermission(context, PermissionFlagsBits.ModerateMembers, 'Moderate Members');
  if (action === 'kick') requirePermission(context, PermissionFlagsBits.KickMembers, 'Kick Members');
  if (action === 'ban' || action === 'unban') requirePermission(context, PermissionFlagsBits.BanMembers, 'Ban Members');
  if (action === 'purge') requirePermission(context, PermissionFlagsBits.ManageMessages, 'Manage Messages');

  const caseRecord = await repository.createCase({
    guildId,
    targetUserId,
    actorUserId,
    action,
    reason,
    durationSeconds: input.durationSeconds ?? null,
    deleteMessageSeconds: input.deleteMessageSeconds ?? null,
    channelId: input.channelId ?? null,
    messageCount: input.messageCount ?? null,
    dmRequested: Boolean(input.sendDm),
    metadata: { clientRequestId: input.clientRequestId },
  });

  let result = 'success';
  let errorCode = null;
  let dmStatus = input.sendDm ? 'failed' : 'not_requested';
  let discordLogStatus = settings.moderation?.discordLogEnabled && settings.moderation?.logChannelId ? 'failed' : 'not_configured';
  const metadata = {};

  try {
    if (action === 'timeout') {
      const until = new Date(Date.now() + input.durationSeconds * 1000).toISOString();
      await restClient.modifyGuildMember(guildId, targetUserId, { communication_disabled_until: until }, reason);
      metadata.communicationDisabledUntil = until;
    } else if (action === 'untimeout') {
      await restClient.modifyGuildMember(guildId, targetUserId, { communication_disabled_until: null }, reason);
    } else if (action === 'kick') {
      await restClient.removeGuildMember(guildId, targetUserId, reason);
    } else if (action === 'ban') {
      await restClient.createGuildBan(guildId, targetUserId, input.deleteMessageSeconds ?? 0, reason);
    } else if (action === 'unban') {
      await restClient.removeGuildBan(guildId, targetUserId, reason);
    } else if (action === 'purge') {
      const messages = await restClient.getChannelMessages(input.channelId, input.messageCount);
      const eligible = messages.filter((message) => snowflakeAgeSeconds(message.id) <= 14 * 24 * 60 * 60);
      if (!eligible.length) throw error('NO_ELIGIBLE_MESSAGES', 'No eligible messages were found in the selected period.');
      const ids = eligible.slice(0, input.messageCount).map((message) => message.id);
      if (ids.length === 1) await restClient.deleteMessage(input.channelId, ids[0], reason);
      else await restClient.bulkDeleteMessages(input.channelId, ids, reason);
      metadata.deletedMessageIds = ids;
      metadata.deletedCount = ids.length;
    }

    if (input.sendDm) {
      try {
        const target = member?.user ?? await restClient.getUser(targetUserId);
        await restClient.sendDirectMessage(targetUserId, {
          content: `Leone moderation notice — case #${caseRecord.case_number}: ${actionLabel(action)}.\nReason: ${reason}${input.durationSeconds ? `\nDuration: ${input.durationSeconds} seconds` : ''}`,
          allowed_mentions: { parse: [] },
        });
        dmStatus = 'sent';
        metadata.dmRecipient = target?.id ?? targetUserId;
      } catch (dmError) {
        metadata.dmError = dmError.code ?? dmError.message;
      }
    }

    const logChannelId = settings.moderation?.logChannelId;
    if (settings.moderation?.discordLogEnabled && logChannelId) {
      try {
        await restClient.sendChannelMessage(logChannelId, {
          content: `**Case #${caseRecord.case_number}** · ${actionLabel(action)} · <@${targetUserId}> · by <@${actorUserId}>\nReason: ${reason}`,
          allowed_mentions: { parse: [], users: [] },
        });
        discordLogStatus = 'sent';
      } catch (logError) {
        metadata.discordLogError = logError.code ?? logError.message;
      }
    }
  } catch (cause) {
    result = 'failed';
    errorCode = cause.code ?? 'DISCORD_ACTION_FAILED';
    metadata.error = cause.message;
    await repository.completeCase({ id: caseRecord.id, result, dmStatus, discordLogStatus, errorCode, metadata });
    await audit.record({ guildId, actorUserId, action: `moderation.${action}`, targetCategory: 'member', targetId: targetUserId, result, reason, metadata: { caseId: caseRecord.id, errorCode } });
    throw cause;
  }

  const completed = await repository.completeCase({ id: caseRecord.id, result, dmStatus, discordLogStatus, metadata });
  await audit.record({ guildId, actorUserId, action: `moderation.${action}`, targetCategory: action === 'purge' ? 'channel' : 'member', targetId: action === 'purge' ? input.channelId : targetUserId, result, reason, metadata: { caseId: caseRecord.id, ...metadata } });
  return completed;
}

function validateModerationInput(input) {
  if (input.action === 'timeout' && (!input.durationSeconds || input.durationSeconds < 1 || input.durationSeconds > 2419200)) {
    throw error('TIMEOUT_DURATION_INVALID', 'Timeout duration must be between 1 second and 28 days.');
  }
  if (input.action === 'purge' && (!input.channelId || !input.messageCount || input.messageCount < 1 || input.messageCount > 100)) {
    throw error('PURGE_LIMIT_INVALID', 'Purge requires a channel and between 1 and 100 messages.');
  }
  if ((input.action === 'ban') && input.deleteMessageSeconds != null && (input.deleteMessageSeconds < 0 || input.deleteMessageSeconds > 604800)) {
    throw error('BAN_DELETE_WINDOW_INVALID', 'Ban message deletion must be between 0 and 7 days.');
  }
  return input;
}

module.exports = { executeModeration, validateModerationInput };
