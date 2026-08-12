const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const { createAniListMediaClient, AniListMediaError } = require('./anilist-media-client');
const { createReadingEmbed, safeReading } = require('./reading-presenter');

const READING_CONFIGS = Object.freeze({
  novel: { name: 'novel', label: 'Novel', format: 'NOVEL' },
  manga: { name: 'manga', label: 'Manga', format: 'MANGA' },
  manhwa: { name: 'manhwa', label: 'Manhwa', format: 'MANGA', country: 'KR' },
  manhua: { name: 'manhua', label: 'Manhua', format: 'MANGA', country: 'CN' },
});

const READING_LISTS = {
  popular: { label: 'Popular', sort: 'POPULARITY_DESC' },
  top_rated: { label: 'Top rated', sort: 'SCORE_DESC' },
  recent: { label: 'Recently started', sort: 'START_DATE_DESC' },
};

const listChoices = Object.entries(READING_LISTS).map(([value, item]) => ({ name: item.label, value }));

function createReadingCommand(config) {
  const data = new SlashCommandBuilder()
    .setName(config.name)
    .setDescription(`Browse, search, and inspect ${config.label.toLowerCase()} titles from AniList.`)
    .addSubcommand((subcommand) => subcommand
      .setName('list')
      .setDescription(`Browse ${config.label.toLowerCase()} catalogs.`)
      .addStringOption((option) => option
        .setName('category')
        .setDescription('Which catalog should Leone show?')
        .addChoices(...listChoices))
      .addIntegerOption((option) => option
        .setName('page')
        .setDescription('Catalog page, from 1 to 500.')
        .setMinValue(1)
        .setMaxValue(500))
      .addBooleanOption((option) => option
        .setName('private')
        .setDescription('Show the results only to you.')))
    .addSubcommand((subcommand) => subcommand
      .setName('search')
      .setDescription(`Search ${config.label.toLowerCase()} titles by name.`)
      .addStringOption((option) => option
        .setName('query')
        .setDescription('Title or keywords.')
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('page')
        .setDescription('Search page, from 1 to 500.')
        .setMinValue(1)
        .setMaxValue(500))
      .addBooleanOption((option) => option
        .setName('private')
        .setDescription('Show the results only to you.')))
    .addSubcommand((subcommand) => subcommand
      .setName('details')
      .setDescription(`Show full ${config.label.toLowerCase()} details for an AniList ID.`)
      .addIntegerOption((option) => option
        .setName('title-id')
        .setDescription('The numeric AniList title ID.')
        .setMinValue(1)
        .setMaxValue(2147483647)
        .setRequired(true))
      .addBooleanOption((option) => option
        .setName('private')
        .setDescription('Show the details only to you.')));

  return {
    data,
    help: {
      area: 'reading',
      usage: `/${config.name} <list|search|details>`,
      summary: `Browse, search, and inspect ${config.label.toLowerCase()} titles.`,
      audience: 'everyone',
      order: config.name === 'novel' ? 10 : config.name === 'manga' ? 20 : config.name === 'manhwa' ? 30 : 40,
    },
    async execute(interaction) {
      const subcommand = interaction.options.getSubcommand();
      const isPrivate = interaction.options.getBoolean('private') ?? false;
      await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : undefined);
      try {
        const client = createAniListMediaClient();
        if (subcommand === 'details') {
          const item = await client.getMediaDetails(interaction.options.getInteger('title-id'));
          await interaction.editReply({ embeds: [createReadingEmbed(item, 0, config, { numbered: false, descriptionLimit: 1200 })], allowedMentions: { parse: [] } });
          return;
        }

        const page = interaction.options.getInteger('page') ?? 1;
        let response;
        let heading;
        if (subcommand === 'search') {
          const query = interaction.options.getString('query', true).trim();
          response = await client.searchMedia(query, { page, format: config.format, country: config.country });
          heading = `${config.label} search results for “${query}”`;
        } else {
          const category = interaction.options.getString('category') ?? 'popular';
          response = await client.listMedia({ page, perPage: 10, format: config.format, country: config.country, sort: READING_LISTS[category].sort });
          heading = `${READING_LISTS[category].label} ${config.label.toLowerCase()} titles`;
        }
        const items = safeReading(response.data);
        if (items.length === 0) {
          await interaction.editReply({ content: `I could not find ${config.label.toLowerCase()} titles for that request. Try another title or catalog.` });
          return;
        }
        const pageText = response.pagination?.currentPage ? ` • Page ${response.pagination.currentPage}` : '';
        await interaction.editReply({
          content: `📚 ${heading}${pageText}. Open a title to view it on AniList.`,
          embeds: items.map((item, index) => createReadingEmbed(item, index, config)),
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        const friendlyError = getFriendlyError(error, config);
        if (!friendlyError) throw error;
        await interaction.editReply({ content: friendlyError });
      }
    },
  };
}

function getFriendlyError(error, config) {
  if (!(error instanceof AniListMediaError)) return null;
  if (error.code === 'RATE_LIMIT') return 'AniList is receiving too many requests right now. Please try again shortly.';
  if (error.code === 'INVALID_REQUEST') return `That ${config.label.toLowerCase()} request is not valid. Please check the selected options.`;
  if (['TIMEOUT', 'UNAVAILABLE', 'UPSTREAM', 'INVALID_RESPONSE'].includes(error.code)) return 'The reading catalog is temporarily unavailable. Please try again later.';
  return null;
}

module.exports = {
  READING_CONFIGS,
  READING_LISTS,
  createReadingCommand,
};
