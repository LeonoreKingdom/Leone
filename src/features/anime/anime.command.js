const {
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const {
  createAnimeEmbed,
  safeAnime,
} = require('./anime-presenter');
const {
  createJikanClient,
  JikanError,
} = require('./jikan-client');
const { AniListError } = require('./anilist-client');
const { searchAnimeWithFallback } = require('./anime-search');

const ANIME_LISTS = {
  bypopularity: 'Popular',
  airing: 'Currently airing',
  upcoming: 'Upcoming',
  favorite: 'Most favorited',
};
const listChoices = Object.entries(ANIME_LISTS).map(
  ([value, name]) => ({ name, value }),
);
const seasonChoices = ['winter', 'spring', 'summer', 'fall']
  .map((value) => ({ name: value[0].toUpperCase() + value.slice(1), value }));

const data = new SlashCommandBuilder()
  .setName('anime')
  .setDescription('Browse, search, and inspect anime from MyAnimeList.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('Browse popular, airing, upcoming, or favorite anime.')
      .addStringOption((option) =>
        option
          .setName('category')
          .setDescription('Which anime catalog should Leone show?')
          .addChoices(...listChoices),
      )
      .addIntegerOption((option) =>
        option
          .setName('page')
          .setDescription('Catalog page, from 1 to 500.')
          .setMinValue(1)
          .setMaxValue(500),
      )
      .addBooleanOption((option) =>
        option.setName('private').setDescription('Show results only to you.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('search')
      .setDescription('Search anime titles and synopses.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Anime title or keywords to search for.')
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('page')
          .setDescription('Search page, from 1 to 500.')
          .setMinValue(1)
          .setMaxValue(500),
      )
      .addBooleanOption((option) =>
        option.setName('private').setDescription('Show results only to you.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('details')
      .setDescription('Show full details for a MyAnimeList anime ID.')
      .addIntegerOption((option) =>
        option
          .setName('anime-id')
          .setDescription('The numeric MyAnimeList anime ID.')
          .setMinValue(1)
          .setMaxValue(2147483647)
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option.setName('private').setDescription('Show details only to you.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('seasonal')
      .setDescription('Browse anime from a release season.')
      .addIntegerOption((option) =>
        option
          .setName('year')
          .setDescription('Year between 1900 and 2100; defaults to this year.')
          .setMinValue(1900)
          .setMaxValue(2100),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season; defaults based on the current month.')
          .addChoices(...seasonChoices),
      )
      .addIntegerOption((option) =>
        option
          .setName('page')
          .setDescription('Season page, from 1 to 500.')
          .setMinValue(1)
          .setMaxValue(500),
      )
      .addBooleanOption((option) =>
        option.setName('private').setDescription('Show results only to you.'),
      ),
  );

const help = {
  area: 'anime',
  usage: '/anime <list|search|details|seasonal>',
  summary: 'Browse catalogs, search titles, inspect details, and explore seasons.',
  audience: 'everyone',
  order: 10,
};

function getPrivate(interaction) {
  return interaction.options.getBoolean('private') ?? false;
}

function getPage(interaction) {
  return interaction.options.getInteger('page') ?? 1;
}

function currentSeason(date = new Date()) {
  const month = date.getUTCMonth() + 1;
  if (month <= 3) return 'winter';
  if (month <= 6) return 'spring';
  if (month <= 9) return 'summer';
  return 'fall';
}

function getFriendlyError(error) {
  if (!(error instanceof JikanError) && !(error instanceof AniListError)) return null;
  switch (error.code) {
    case 'RATE_LIMIT':
      return 'Jikan is receiving too many requests right now. Please try again shortly.';
    case 'TIMEOUT':
    case 'UNAVAILABLE':
    case 'UPSTREAM':
    case 'INVALID_RESPONSE':
      return 'The anime catalog is temporarily unavailable. Please try again later.';
    case 'INVALID_REQUEST':
      return 'That anime request is not valid. Check the selected options and try again.';
    default:
      return null;
  }
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const isPrivate = getPrivate(interaction);
  await interaction.deferReply(
    isPrivate ? { flags: MessageFlags.Ephemeral } : undefined,
  );

  try {
    const client = createJikanClient();

    if (subcommand === 'details') {
      const anime = (await client.getAnimeDetails(
        interaction.options.getInteger('anime-id'),
      )).data;
      await interaction.editReply({
        embeds: [createAnimeEmbed(anime, 0, { numbered: false, descriptionLimit: 1200 })],
        allowedMentions: { parse: [] },
      });
      return;
    }

    let response;
    let heading;

    if (subcommand === 'search') {
      const query = interaction.options.getString('query', true).trim();
      const page = getPage(interaction);
      response = await searchAnimeWithFallback({
        jikanClient: client,
        query,
        page,
        options: { limit: 5 },
      });
      heading = `Anime search results for “${query}”${response.source === 'anilist' ? ' (AniList fallback)' : ''}`;
    } else if (subcommand === 'seasonal') {
      const year = interaction.options.getInteger('year') ?? new Date().getUTCFullYear();
      const season = interaction.options.getString('season') ?? currentSeason();
      response = await client.listSeasonalAnime(year, season, getPage(interaction));
      heading = `${season[0].toUpperCase() + season.slice(1)} ${year} anime`;
    } else {
      const category = interaction.options.getString('category') ?? 'bypopularity';
      response = await client.listAnime(category, getPage(interaction));
      heading = `${ANIME_LISTS[category]} anime`;
    }

    const anime = safeAnime(response.data);
    if (anime.length === 0) {
      await interaction.editReply({
        content: 'I could not find anime for that request. Try another title or catalog.',
      });
      return;
    }

    const pageText = response.pagination?.current_page
      ? ` • Page ${response.pagination.current_page}`
      : '';
    await interaction.editReply({
      content: `✨ ${heading}${pageText}. Open a title for its MyAnimeList page.`,
      embeds: anime.map((item, index) => createAnimeEmbed(item, index, { descriptionLimit: 600 })),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const friendlyError = getFriendlyError(error);
    if (!friendlyError) throw error;
    await interaction.editReply({ content: friendlyError });
  }
}

module.exports = {
  ANIME_LISTS,
  currentSeason,
  data,
  execute,
  getFriendlyError,
  help,
};
