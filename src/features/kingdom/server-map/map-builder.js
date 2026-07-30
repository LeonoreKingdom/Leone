const {
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

const { canViewChannel } = require('../../../services/guild');
const {
  KINGDOM_COLOR,
} = require('../../../shared/constants');

const CHANNELS_PER_FIELD_LENGTH = 950;
const MAP_FIELDS_PER_EMBED = 20;
const MAP_CHARACTERS_PER_EMBED = 5000;
const MAX_EMBEDS = 10;

/**
 * Pack channel mentions into Discord embed-field-sized strings.
 *
 * @param {string[]} mentions
 */
function packChannelMentions(mentions) {
  const chunks = [];
  let currentChunk = '';

  for (const mention of mentions) {
    const candidate = currentChunk
      ? `${currentChunk} • ${mention}`
      : mention;

    if (
      candidate.length > CHANNELS_PER_FIELD_LENGTH &&
      currentChunk
    ) {
      chunks.push(currentChunk);
      currentChunk = mention;
    } else {
      currentChunk = candidate;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Build a paginated map containing only channels visible to the caller.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember} member
 */
function buildServerMapEmbeds(guild, member) {
  const allChannels = [...guild.channels.cache.values()];
  const visibleChannels = allChannels.filter(
    (channel) =>
      channel.type !== ChannelType.GuildCategory &&
      canViewChannel(channel, member),
  );
  const categories = allChannels
    .filter(
      (channel) => channel.type === ChannelType.GuildCategory,
    )
    .sort(
      (left, right) =>
        left.rawPosition - right.rawPosition ||
        left.name.localeCompare(right.name),
    );
  const fields = [];

  const addChannelGroup = (groupName, channels) => {
    const mentions = channels
      .sort(
        (left, right) =>
          left.rawPosition - right.rawPosition ||
          left.name.localeCompare(right.name),
      )
      .map((channel) => `<#${channel.id}>`);

    for (const [index, value] of packChannelMentions(
      mentions,
    ).entries()) {
      fields.push({
        name:
          index === 0
            ? `🏰 ${groupName}`
            : `↳ ${groupName} (continued)`,
        value,
      });
    }
  };

  for (const category of categories) {
    const childChannels = visibleChannels.filter(
      (channel) => channel.parentId === category.id,
    );

    if (childChannels.length > 0) {
      addChannelGroup(category.name, childChannels);
    }
  }

  const uncategorizedChannels = visibleChannels.filter(
    (channel) => !channel.parentId,
  );

  if (uncategorizedChannels.length > 0) {
    addChannelGroup('Other channels', uncategorizedChannels);
  }

  if (fields.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(KINGDOM_COLOR)
        .setTitle(`${guild.name} — Kingdom Map`)
        .setDescription('No channels are currently visible to you.'),
    ];
  }

  const pages = [];
  let currentPage = [];
  let currentPageLength = 0;

  for (const field of fields) {
    const fieldLength = field.name.length + field.value.length;
    const pageIsFull =
      currentPage.length >= MAP_FIELDS_PER_EMBED ||
      (currentPage.length > 0 &&
        currentPageLength + fieldLength >
          MAP_CHARACTERS_PER_EMBED);

    if (pageIsFull) {
      pages.push(currentPage);
      currentPage = [];
      currentPageLength = 0;
    }

    currentPage.push(field);
    currentPageLength += fieldLength;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  const visiblePages = pages.slice(0, MAX_EMBEDS);
  const wasTruncated = pages.length > visiblePages.length;

  return visiblePages.map((pageFields, index) => {
    const embed = new EmbedBuilder()
      .setColor(KINGDOM_COLOR)
      .setTitle(
        index === 0
          ? `${guild.name} — Kingdom Map`
          : `Kingdom Map — Page ${index + 1}`,
      )
      .addFields(pageFields);

    if (index === 0) {
      embed.setDescription(
        [
          'Only channels you can currently view are shown.',
          wasTruncated
            ? 'This server is too large to display every channel in one response.'
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    if (visiblePages.length > 1) {
      embed.setFooter({
        text: `Page ${index + 1} of ${visiblePages.length}`,
      });
    }

    return embed;
  });
}

module.exports = {
  buildServerMapEmbeds,
};
