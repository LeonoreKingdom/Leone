const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const MAX_BULK_MEMBERS = 100;
const SUPPORTED_CHANNEL_TYPES = new Set([0, 2, 4, 5, 13, 15]);

function error(code, message, status = 400) {
  const result = new Error(message);
  result.code = code;
  result.status = status;
  return result;
}

function rolePosition(role) {
  return Number(role?.position ?? 0);
}

function highestRole(roles, roleIds) {
  return roles
    .filter((role) => roleIds.includes(role.id))
    .sort((left, right) => rolePosition(right) - rolePosition(left))[0] ?? null;
}

function botPermissions(bundle, botMember) {
  const everyone = bundle.roles.find((role) => role.id === bundle.guild.id);
  const permissions = new PermissionsBitField(BigInt(everyone?.permissions ?? 0));
  for (const role of bundle.roles) {
    if (botMember.roles?.includes(role.id)) permissions.add(BigInt(role.permissions ?? 0));
  }
  return permissions;
}

function assertPermission(permissions, permission, label) {
  if (!permissions.has(permission)) throw error('BOT_PERMISSION_REQUIRED', `Leone needs ${label} in Discord.`, 409);
}

async function loadContext({ guildId, restClient }) {
  const [bundle, botUser] = await Promise.all([
    restClient.getGuildBundle(guildId, { refresh: true }),
    restClient.getBotUser(),
  ]);
  const botMember = await restClient.getGuildMember(guildId, botUser.id);
  const botRole = highestRole(bundle.roles, botMember.roles ?? []);
  return {
    bundle,
    botUser,
    botMember,
    botRole,
    permissions: botPermissions(bundle, botMember),
  };
}

function findRole(context, roleId) {
  const role = context.bundle.roles.find((item) => item.id === roleId);
  if (!role) throw error('ROLE_NOT_FOUND', 'The selected Discord role no longer exists.', 404);
  return role;
}

function assertRoleManageable(context, roleId) {
  const role = findRole(context, roleId);
  if (role.id === context.bundle.guild.id) throw error('EVERYONE_ROLE_FORBIDDEN', 'The @everyone role cannot be managed here.');
  if (role.managed) throw error('MANAGED_ROLE_FORBIDDEN', 'Managed integration and bot roles cannot be edited.');
  if (!context.botRole || rolePosition(role) >= rolePosition(context.botRole)) {
    throw error('ROLE_HIERARCHY_BLOCKED', 'Leone must have a higher role than the selected role.', 409);
  }
  return role;
}

async function getMembers({ context, userIds, restClient }) {
  const unique = [...new Set(userIds)];
  if (!unique.length || unique.length > MAX_BULK_MEMBERS) {
    throw error('BULK_MEMBER_LIMIT', `Select between 1 and ${MAX_BULK_MEMBERS} members.`);
  }
  const members = await Promise.all(unique.map(async (userId) => {
    try {
      return await restClient.getGuildMember(context.bundle.guild.id, userId);
    } catch (cause) {
      if (cause.status === 404) throw error('MEMBER_NOT_FOUND', `Member ${userId} is not in this guild.`, 404);
      throw cause;
    }
  }));
  for (const member of members) {
    if (member.user.id === context.bundle.guild.owner_id) throw error('OWNER_TARGET_FORBIDDEN', 'The guild owner cannot be changed by Leone.');
    const highest = highestRole(context.bundle.roles, member.roles ?? []);
    if (!context.botRole || (highest && rolePosition(highest) >= rolePosition(context.botRole))) {
      throw error('MEMBER_HIERARCHY_BLOCKED', `Leone cannot manage ${member.user.global_name ?? member.user.username ?? member.user.id} because their highest role is not below Leone.`, 409);
    }
  }
  return members;
}

function memberLabel(member) {
  return member.user?.global_name ?? member.user?.username ?? member.user?.id;
}

async function previewRoleOperation({ guildId, restClient, action, roleId, userIds }) {
  if (!['assign', 'remove'].includes(action)) throw error('INVALID_ROLE_OPERATION', 'Role operation must be assign or remove.');
  const context = await loadContext({ guildId, restClient });
  assertPermission(context.permissions, PermissionFlagsBits.ManageRoles, 'Manage Roles');
  const role = assertRoleManageable(context, roleId);
  const members = await getMembers({ context, userIds, restClient });
  const affected = members.filter((member) => action === 'assign'
    ? !member.roles?.includes(role.id)
    : member.roles?.includes(role.id));
  return {
    action,
    role: { id: role.id, name: role.name, position: role.position },
    members: affected.map((member) => ({ id: member.user.id, label: memberLabel(member) })),
    requestedCount: members.length,
    affectedCount: affected.length,
    confirmationPhrase: `${action.toUpperCase()} ${affected.length} MEMBERS`,
  };
}

async function executeRoleOperation({ guildId, restClient, action, roleId, userIds, reason, preview: suppliedPreview = null }) {
  const preview = suppliedPreview ?? await previewRoleOperation({ guildId, restClient, action, roleId, userIds });
  const context = await loadContext({ guildId, restClient });
  assertPermission(context.permissions, PermissionFlagsBits.ManageRoles, 'Manage Roles');
  assertRoleManageable(context, roleId);
  for (const member of preview.members) {
    if (action === 'assign') await restClient.addMemberRole(guildId, member.id, roleId, reason);
    else await restClient.removeMemberRole(guildId, member.id, roleId, reason);
  }
  return { ...preview, result: 'success', reason };
}

async function createRole({ guildId, restClient, payload, reason }) {
  const context = await loadContext({ guildId, restClient });
  assertPermission(context.permissions, PermissionFlagsBits.ManageRoles, 'Manage Roles');
  return restClient.createRole(guildId, {
    name: payload.name,
    color: payload.color ?? 0,
    hoist: Boolean(payload.hoist),
    mentionable: Boolean(payload.mentionable),
    permissions: '0',
  }, reason);
}

async function updateRole({ guildId, restClient, roleId, payload, reason }) {
  const context = await loadContext({ guildId, restClient });
  assertPermission(context.permissions, PermissionFlagsBits.ManageRoles, 'Manage Roles');
  assertRoleManageable(context, roleId);
  return restClient.updateRole(guildId, roleId, {
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.color !== undefined ? { color: payload.color } : {}),
    ...(payload.hoist !== undefined ? { hoist: Boolean(payload.hoist) } : {}),
    ...(payload.mentionable !== undefined ? { mentionable: Boolean(payload.mentionable) } : {}),
  }, reason);
}

function channelPayload(input) {
  if (!SUPPORTED_CHANNEL_TYPES.has(input.type)) throw error('CHANNEL_TYPE_UNSUPPORTED', 'This channel type is not supported by Leone.');
  const payload = { name: input.name, type: input.type };
  const textLike = [0, 5, 15].includes(input.type);
  const voiceLike = [2, 13].includes(input.type);
  if (input.parentId !== undefined) payload.parent_id = input.parentId || null;
  if (textLike && input.topic !== undefined) payload.topic = input.topic || null;
  if (textLike && input.rateLimitPerUser !== undefined) payload.rate_limit_per_user = input.rateLimitPerUser;
  if (textLike && input.nsfw !== undefined) payload.nsfw = Boolean(input.nsfw);
  if (voiceLike && input.bitrate !== undefined) payload.bitrate = input.bitrate;
  if (voiceLike && input.userLimit !== undefined) payload.user_limit = input.userLimit;
  return payload;
}

async function createChannel({ guildId, restClient, payload, reason }) {
  const context = await loadContext({ guildId, restClient });
  assertPermission(context.permissions, PermissionFlagsBits.ManageChannels, 'Manage Channels');
  return restClient.createChannel(guildId, channelPayload(payload), reason);
}

async function updateChannel({ guildId, restClient, channelId, payload, reason }) {
  const context = await loadContext({ guildId, restClient });
  assertPermission(context.permissions, PermissionFlagsBits.ManageChannels, 'Manage Channels');
  const channel = context.bundle.channels.find((item) => item.id === channelId);
  if (!channel) throw error('CHANNEL_NOT_FOUND', 'The selected Discord channel no longer exists.', 404);
  return restClient.updateChannel(channelId, channelPayload({ ...channel, ...payload, type: channel.type }), reason);
}

async function archiveChannel({ guildId, restClient, channelId, archiveCategoryId, reason }) {
  const context = await loadContext({ guildId, restClient });
  assertPermission(context.permissions, PermissionFlagsBits.ManageChannels, 'Manage Channels');
  const channel = context.bundle.channels.find((item) => item.id === channelId);
  if (!channel) throw error('CHANNEL_NOT_FOUND', 'The selected Discord channel no longer exists.', 404);
  const category = context.bundle.channels.find((item) => item.id === archiveCategoryId && item.type === 4);
  if (!category) throw error('ARCHIVE_CATEGORY_NOT_FOUND', 'Configure a valid archive category first.', 400);
  const deny = PermissionFlagsBits.ViewChannel
    | PermissionFlagsBits.SendMessages
    | PermissionFlagsBits.Connect
    | PermissionFlagsBits.CreatePublicThreads
    | PermissionFlagsBits.CreatePrivateThreads;
  await restClient.setChannelPermission(channelId, guildId, { type: 0, allow: '0', deny: String(deny) }, reason);
  const updated = await restClient.updateChannel(channelId, { parent_id: archiveCategoryId }, reason);
  return { channel: updated, archiveCategoryId, locked: true };
}

async function serverReadiness({ guildId, restClient }) {
  const context = await loadContext({ guildId, restClient });
  const required = [
    ['Manage Roles', PermissionFlagsBits.ManageRoles],
    ['Manage Channels', PermissionFlagsBits.ManageChannels],
    ['Moderate Members', PermissionFlagsBits.ModerateMembers],
    ['Kick Members', PermissionFlagsBits.KickMembers],
    ['Ban Members', PermissionFlagsBits.BanMembers],
    ['Manage Messages', PermissionFlagsBits.ManageMessages],
  ];
  return {
    bot: { id: context.botUser.id, roleId: context.botRole?.id ?? null, roleName: context.botRole?.name ?? null, rolePosition: context.botRole?.position ?? null },
    permissions: Object.fromEntries(required.map(([name, permission]) => [name, context.permissions.has(permission)])),
    roles: context.bundle.roles.map((role) => ({ id: role.id, name: role.name, position: role.position, managed: Boolean(role.managed) })),
    channels: context.bundle.channels.map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parent_id ?? null })),
  };
}

module.exports = {
  MAX_BULK_MEMBERS,
  SUPPORTED_CHANNEL_TYPES,
  archiveChannel,
  createChannel,
  createRole,
  error,
  executeRoleOperation,
  getMembers,
  highestRole,
  loadContext,
  previewRoleOperation,
  rolePosition,
  serverReadiness,
  updateChannel,
  updateRole,
};
