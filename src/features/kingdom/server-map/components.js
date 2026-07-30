const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const { buildServerMapEmbeds } = require('./map-builder');

const prefix = 'server-map';

/**
 * @param {string} requesterId
 * @param {number} pageIndex
 * @param {number} pageCount
 */
function buildServerMapComponents(
  requesterId,
  pageIndex,
  pageCount,
) {
  if (pageCount <= 1) {
    return [];
  }

  const previousPageIndex = Math.max(0, pageIndex - 1);
  const nextPageIndex = Math.min(
    pageCount - 1,
    pageIndex + 1,
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${prefix}:${requesterId}:${previousPageIndex}`,
      )
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}:${requesterId}:${nextPageIndex}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIndex === pageCount - 1),
  );

  return [row];
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string[]} parameters
 */
async function execute(interaction, parameters) {
  const [requesterId, requestedPageValue] = parameters;

  if (!requesterId || requestedPageValue === undefined) {
    throw new Error('Malformed server-map component identifier.');
  }

  if (interaction.user.id !== requesterId) {
    await interaction.reply({
      content:
        'Only the member who opened this map can change its page.',
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This map is no longer available inside a server.',
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  await interaction.deferUpdate();

  const embeds = buildServerMapEmbeds(
    interaction.guild,
    interaction.member,
  );
  const requestedPage = Number.parseInt(
    requestedPageValue,
    10,
  );
  const pageIndex = Number.isInteger(requestedPage)
    ? Math.min(Math.max(requestedPage, 0), embeds.length - 1)
    : 0;

  await interaction.editReply({
    embeds: [embeds[pageIndex]],
    components: buildServerMapComponents(
      requesterId,
      pageIndex,
      embeds.length,
    ),
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  buildServerMapComponents,
  componentHandler: {
    execute,
    prefix,
  },
};
