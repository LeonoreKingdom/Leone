const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const { createGameEmbed, safeGames } = require('./game-presenter');
const { createRawgClient, RawgError } = require('./rawg-client');

const GAME_LISTS = {
  popular: { label: 'Popular', ordering: '-added' },
  top_rated: { label: 'Top rated', ordering: '-rating' },
  recently_released: { label: 'Recently released', ordering: '-released' },
  upcoming: { label: 'Upcoming', ordering: 'released' },
};

const listChoices = Object.entries(GAME_LISTS).map(([value, item]) => ({
  name: item.label,
  value,
}));

const data = new SlashCommandBuilder()
  .setName('game')
  .setDescription('Browse, search, and inspect games from RAWG.')
  .addSubcommand((subcommand) => subcommand
    .setName('list')
    .setDescription('Browse a game catalog.')
    .addStringOption((option) => option
      .setName('category')
      .setDescription('Which game catalog should Leone show?')
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
    .setDescription('Search games by title.')
    .addStringOption((option) => option
      .setName('query')
      .setDescription('Game title or keywords.')
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
    .setDescription('Show details for a RAWG game ID or slug.')
    .addStringOption((option) => option
      .setName('game-id')
      .setDescription('The RAWG numeric ID or slug.')
      .setMinLength(1)
      .setMaxLength(100)
      .setRequired(true))
    .addBooleanOption((option) => option
      .setName('private')
      .setDescription('Show the details only to you.')))
  .addSubcommand((subcommand) => subcommand
    .setName('upcoming')
    .setDescription('Show games scheduled for release in the next year.')
    .addIntegerOption((option) => option
      .setName('page')
      .setDescription('Catalog page, from 1 to 500.')
      .setMinValue(1)
      .setMaxValue(500))
    .addBooleanOption((option) => option
      .setName('private')
      .setDescription('Show the results only to you.')));

const help = {
  area: 'games',
  usage: '/game <list|search|details|upcoming>',
  summary: 'Browse games, inspect details, and find upcoming releases.',
  audience: 'everyone',
  order: 10,
};

function getPrivate(interaction) {
  return interaction.options.getBoolean('private') ?? false;
}

function getPage(interaction) {
  return interaction.options.getInteger('page') ?? 1;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getFriendlyError(error) {
  if (!(error instanceof RawgError)) return null;
  switch (error.code) {
    case 'CONFIGURATION': return 'Game search is not configured yet. Add `RAWG_API_KEY` to Leone’s environment.';
    case 'AUTHENTICATION': return 'RAWG rejected Leone’s API key. Please check the configured credential.';
    case 'RATE_LIMIT': return 'RAWG is receiving too many requests right now. Please try again shortly.';
    case 'INVALID_REQUEST': return 'That game request is not valid. Please check the selected options.';
    case 'TIMEOUT':
    case 'UNAVAILABLE':
    case 'UPSTREAM':
    case 'INVALID_RESPONSE': return 'The game catalog is temporarily unavailable. Please try again later.';
    default: return null;
  }
}

function listQuery(category, page) {
  const today = new Date();
  const item = GAME_LISTS[category] ?? GAME_LISTS.popular;
  const query = { page, ordering: item.ordering };
  if (category === 'upcoming') {
    const end = new Date(today);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    query.dates = `${isoDate(today)},${isoDate(end)}`;
  }
  if (category === 'recently_released') {
    const start = new Date(today);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    query.dates = `${isoDate(start)},${isoDate(today)}`;
  }
  return query;
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const isPrivate = getPrivate(interaction);
  await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : undefined);

  try {
    const client = createRawgClient();
    if (subcommand === 'details') {
      const game = await client.getGameDetails(interaction.options.getString('game-id', true));
      await interaction.editReply({ embeds: [createGameEmbed(game, 0, { numbered: false, descriptionLimit: 1200 })], allowedMentions: { parse: [] } });
      return;
    }

    let response;
    let heading;
    if (subcommand === 'search') {
      const query = interaction.options.getString('query', true).trim();
      response = await client.searchGames(query, { page: getPage(interaction) });
      heading = `Game search results for “${query}”`;
    } else if (subcommand === 'upcoming') {
      response = await client.listGames({ ...listQuery('upcoming', getPage(interaction)), pageSize: 5 });
      heading = 'Upcoming games';
    } else {
      const category = interaction.options.getString('category') ?? 'popular';
      response = await client.listGames({ ...listQuery(category, getPage(interaction)), pageSize: 5 });
      heading = `${GAME_LISTS[category].label} games`;
    }

    const games = safeGames(response.results);
    if (games.length === 0) {
      await interaction.editReply({ content: 'I could not find games for that request. Try another title or catalog.' });
      return;
    }

    const pageText = response.page && response.count ? ` • Page ${response.page}` : '';
    await interaction.editReply({
      content: `🎮 ${heading}${pageText}. Open a title to view its RAWG page.`,
      embeds: games.map((game, index) => createGameEmbed(game, index)),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const friendlyError = getFriendlyError(error);
    if (!friendlyError) throw error;
    await interaction.editReply({ content: friendlyError });
  }
}

module.exports = {
  GAME_LISTS,
  data,
  execute,
  getFriendlyError,
  help,
  listQuery,
};
