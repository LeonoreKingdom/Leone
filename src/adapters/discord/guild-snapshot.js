const {
  ChannelType,
  Collection,
  PermissionsBitField,
  PermissionFlagsBits,
  SnowflakeUtil,
} = require('discord.js');

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

function avatarUrl(user, size = 256) {
  if (!user?.avatar) {
    const index = user?.discriminator && user.discriminator !== '0'
      ? Number(user.discriminator) % 5
      : Number((BigInt(user?.id ?? 0) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
}

function createUser(raw, restClient) {
  return {
    ...raw,
    displayName: raw.global_name ?? raw.username,
    displayAvatarURL: ({ size = 256 } = {}) => avatarUrl(raw, size),
    send: (payload) => restClient.sendDirectMessage(raw.id, payload),
  };
}

function applyOverwrite(permissions, overwrite) {
  if (!overwrite) return permissions;
  permissions.remove(BigInt(overwrite.deny ?? 0));
  permissions.add(BigInt(overwrite.allow ?? 0));
  return permissions;
}

function calculateChannelPermissions({ guildId, roles, channel, member }) {
  const everyone = roles.get(guildId);
  const permissions = new PermissionsBitField(
    BigInt(everyone?.permissions ?? 0),
  );

  for (const roleId of member.roles ?? []) {
    const role = roles.get(roleId);
    if (role) permissions.add(BigInt(role.permissions ?? 0));
  }

  if (permissions.has(PermissionFlagsBits.Administrator)) {
    return new PermissionsBitField(PermissionsBitField.All);
  }

  const overwrites = channel.permission_overwrites ?? [];
  applyOverwrite(
    permissions,
    overwrites.find((item) => item.type === 0 && item.id === guildId),
  );
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === 0 && member.roles?.includes(overwrite.id)) {
      roleAllow |= BigInt(overwrite.allow ?? 0);
      roleDeny |= BigInt(overwrite.deny ?? 0);
    }
  }
  permissions.remove(roleDeny);
  permissions.add(roleAllow);
  applyOverwrite(
    permissions,
    overwrites.find((item) => item.type === 1 && item.id === member.user.id),
  );
  return permissions;
}

async function createGuildSnapshot({ guildId, member, restClient, channelId }) {
  const [{ guild, channels, roles: rawRoles }, botUser] = await Promise.all([
    restClient.getGuildBundle(guildId),
    restClient.getBotUser(),
  ]);
  const roles = new Collection(
    rawRoles.map((role) => [
      role.id,
      {
        ...role,
        mentionable: Boolean(role.mentionable),
      },
    ]),
  );
  const memberUser = createUser(member.user, restClient);
  const memberSnapshot = {
    ...member,
    user: memberUser,
    roles: member.roles ?? [],
  };
  const channelCollection = new Collection();

  for (const rawChannel of channels) {
    const channel = {
      ...rawChannel,
      parentId: rawChannel.parent_id ?? null,
      rawPosition: rawChannel.position ?? 0,
      isTextBased: () => TEXT_CHANNEL_TYPES.has(rawChannel.type),
      permissionsFor: (candidate) =>
        calculateChannelPermissions({
          guildId,
          roles,
          channel: rawChannel,
          member: candidate,
        }),
      send: (payload) => restClient.sendChannelMessage(rawChannel.id, payload),
    };
    channelCollection.set(channel.id, channel);
  }

  const bot = createUser(botUser, restClient);
  const snapshot = {
    id: guild.id,
    name: guild.name,
    ownerId: guild.owner_id,
    rulesChannelId: guild.rules_channel_id ?? null,
    memberCount: guild.approximate_member_count ?? 0,
    createdTimestamp: Number(SnowflakeUtil.timestampFrom(guild.id)),
    iconURL: ({ size = 256 } = {}) =>
      guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size}`
        : null,
    channels: { cache: channelCollection },
    roles: { cache: roles },
  };

  return {
    bot,
    channel: channelCollection.get(channelId) ?? null,
    guild: snapshot,
    member: memberSnapshot,
  };
}

module.exports = {
  avatarUrl,
  calculateChannelPermissions,
  createGuildSnapshot,
  createUser,
};
