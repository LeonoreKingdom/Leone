const {
  InteractionResponseType,
} = require('discord-interactions');
const {
  InteractionType,
  PermissionsBitField,
  SnowflakeUtil,
} = require('discord.js');

const { createGuildSnapshot, createUser } = require('./guild-snapshot');
const { normalizeMessagePayload } = require('./rest-client');

function getLeafOptions(data) {
  const top = data.options ?? [];
  const group = top.find((option) => option.type === 2) ?? null;
  const subcommand = (group?.options ?? top).find(
    (option) => option.type === 1,
  ) ?? null;
  return {
    group,
    subcommand,
    options: subcommand?.options ?? top.filter((option) => option.type > 2),
  };
}

function createOptions(payload, context, restClient) {
  const leaf = getLeafOptions(payload.data ?? {});
  const resolved = payload.data?.resolved ?? {};
  const find = (name, required) => {
    const option = leaf.options.find((candidate) => candidate.name === name);
    if (!option && required) throw new Error(`Missing required option: ${name}`);
    return option ?? null;
  };

  return {
    getSubcommand: () => leaf.subcommand?.name ?? null,
    getSubcommandGroup: () => leaf.group?.name ?? null,
    getString: (name, required = false) => find(name, required)?.value ?? null,
    getBoolean: (name, required = false) => find(name, required)?.value ?? null,
    getNumber: (name, required = false) => find(name, required)?.value ?? null,
    getInteger: (name, required = false) => find(name, required)?.value ?? null,
    getUser: (name, required = false) => {
      const option = find(name, required);
      if (!option) return null;
      const user = resolved.users?.[option.value];
      if (!user && required) throw new Error(`Discord did not resolve user option: ${name}`);
      return user ? createUser(user, restClient) : null;
    },
    getRole: (name, required = false) => {
      const option = find(name, required);
      if (!option) return null;
      return context.guild.roles.cache.get(option.value) ?? resolved.roles?.[option.value] ?? null;
    },
    getChannel: (name, required = false) => {
      const option = find(name, required);
      if (!option) return null;
      return context.guild.channels.cache.get(option.value) ?? null;
    },
  };
}

function responseData(payload) {
  return normalizeMessagePayload(payload);
}

async function createHttpInteraction({
  payload,
  response,
  restClient,
  preDeferred = false,
}) {
  if (!payload.guild_id || !payload.member?.user) {
    throw new Error('Leone commands currently require a guild interaction.');
  }
  const context = await createGuildSnapshot({
    guildId: payload.guild_id,
    member: payload.member,
    restClient,
    channelId: payload.channel_id,
  });
  const isCommand = payload.type === InteractionType.ApplicationCommand;
  const isButton = payload.type === InteractionType.MessageComponent;
  const interaction = {
    appPermissions: new PermissionsBitField(BigInt(payload.app_permissions ?? 0)),
    channel: context.channel,
    client: { user: context.bot, ws: { ping: null } },
    commandName: isCommand ? payload.data.name : null,
    createdTimestamp: Number(SnowflakeUtil.timestampFrom(payload.id)),
    customId: isButton ? payload.data.custom_id : null,
    deferred: preDeferred,
    guild: context.guild,
    guildId: payload.guild_id,
    id: payload.id,
    locale: payload.locale,
    member: context.member,
    memberPermissions: new PermissionsBitField(BigInt(payload.member.permissions ?? 0)),
    replied: false,
    token: payload.token,
    user: context.member.user,
    inGuild: () => true,
    isButton: () => isButton,
    isChatInputCommand: () => isCommand,
  };
  interaction.options = createOptions(payload, context, restClient);
  interaction.reply = async (message) => {
    if (interaction.deferred && !interaction.replied) {
      interaction.replied = true;
      return interaction.editReply(message);
    }
    if (interaction.replied) {
      return interaction.followUp(message);
    }
    interaction.replied = true;
    response.status(200).json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: responseData(message),
    });
    return message;
  };
  interaction.deferReply = async (message = {}) => {
    if (interaction.deferred) return;
    interaction.deferred = true;
    response.status(200).json({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: responseData(message),
    });
  };
  interaction.deferUpdate = async () => {
    if (interaction.deferred) return;
    interaction.deferred = true;
    response.status(200).json({
      type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
    });
  };
  interaction.editReply = async (message) =>
    restClient.editInteractionReply(payload.application_id, payload.token, message);
  interaction.followUp = async (message) =>
    restClient.followUp(payload.application_id, payload.token, message);
  return interaction;
}

module.exports = {
  createHttpInteraction,
  createOptions,
  getLeafOptions,
};
