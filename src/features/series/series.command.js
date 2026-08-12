const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const { createTmdbClient, TV_LIST_PATHS, TmdbError } = require('../recommendations/tmdb-client');
const { createSeriesEmbed, safeSeries } = require('./series-presenter');

const SERIES_LISTS = {
  popular: 'Popular',
  airing_today: 'Airing today',
  on_the_air: 'On the air',
  top_rated: 'Top rated',
};
const listChoices = Object.entries(SERIES_LISTS).map(([value, name]) => ({ name, value }));

const data = new SlashCommandBuilder()
  .setName('series')
  .setDescription('Browse, search, and inspect TV series from TMDB.')
  .addSubcommand((subcommand) => subcommand
    .setName('list')
    .setDescription('Browse a TV series catalog.')
    .addStringOption((option) => option
      .setName('category')
      .setDescription('Which series catalog should Leone show?')
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
    .setDescription('Search TV series by title.')
    .addStringOption((option) => option
      .setName('query')
      .setDescription('Series title or keywords.')
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
    .setDescription('Show details for a TMDB TV series ID.')
    .addIntegerOption((option) => option
      .setName('series-id')
      .setDescription('The numeric TMDB series ID.')
      .setMinValue(1)
      .setMaxValue(2147483647)
      .setRequired(true))
    .addBooleanOption((option) => option
      .setName('private')
      .setDescription('Show the details only to you.')))
  .addSubcommand((subcommand) => subcommand
    .setName('trending')
    .setDescription('Show TV series trending on TMDB.')
    .addStringOption((option) => option
      .setName('period')
      .setDescription('How far back should the trend be measured?')
      .addChoices({ name: 'Today', value: 'day' }, { name: 'This week', value: 'week' }))
    .addBooleanOption((option) => option
      .setName('private')
      .setDescription('Show the results only to you.')));

const help = {
  area: 'series',
  usage: '/series <list|search|details|trending>',
  summary: 'Browse TV series, inspect details, and see trends.',
  audience: 'everyone',
  order: 10,
};

function getPrivate(interaction) { return interaction.options.getBoolean('private') ?? false; }
function getPage(interaction) { return interaction.options.getInteger('page') ?? 1; }

function getSeriesFriendlyError(error) {
  if (!(error instanceof TmdbError)) return null;
  if (error.code === 'CONFIGURATION') return 'Series search is not configured yet. Add `TMDB_READ_ACCESS_TOKEN` or `TMDB_API_KEY` to Leone’s environment.';
  if (error.code === 'AUTHENTICATION') return 'TMDB rejected Leone’s credential. Please check the configured token or API key.';
  if (error.code === 'RATE_LIMIT') return 'TMDB is receiving too many requests right now. Please try again shortly.';
  if (['TIMEOUT', 'UNAVAILABLE', 'UPSTREAM', 'INVALID_RESPONSE'].includes(error.code)) return 'The series catalog is temporarily unavailable. Please try again later.';
  if (error.code === 'INVALID_REQUEST') return 'That series request is not valid. Please check the selected options.';
  return null;
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const isPrivate = getPrivate(interaction);
  await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : undefined);

  try {
    const client = createTmdbClient();
    const language = interaction.locale?.toLowerCase().startsWith('id') ? 'id-ID' : 'en-US';
    if (subcommand === 'details') {
      const series = await client.getTvDetails(interaction.options.getInteger('series-id'), { language });
      await interaction.editReply({ embeds: [createSeriesEmbed(series, 0, { numbered: false, descriptionLimit: 1200 })], allowedMentions: { parse: [] } });
      return;
    }

    let response;
    let heading;
    if (subcommand === 'search') {
      const query = interaction.options.getString('query', true).trim();
      response = await client.searchTv(query, { language, page: getPage(interaction) });
      heading = `Series search results for “${query}”`;
    } else if (subcommand === 'trending') {
      const period = interaction.options.getString('period') ?? 'week';
      response = await client.trendingTv(period, { language });
      heading = `Series trending ${period === 'day' ? 'today' : 'this week'}`;
    } else {
      const category = interaction.options.getString('category') ?? 'popular';
      response = await client.listTv(category, { language, page: getPage(interaction) });
      heading = `${SERIES_LISTS[category]} series`;
    }

    const series = safeSeries(response.results);
    if (series.length === 0) {
      await interaction.editReply({ content: 'I could not find series for that request. Try another title or catalog.' });
      return;
    }
    const pageText = response.page && response.total_pages ? ` • Page ${response.page} of ${Math.min(response.total_pages, 500)}` : '';
    await interaction.editReply({
      content: `📺 ${heading}${pageText}. Open a title to view its TMDB page.`,
      embeds: series.map((item, index) => createSeriesEmbed(item, index)),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const friendlyError = getSeriesFriendlyError(error);
    if (!friendlyError) throw error;
    await interaction.editReply({ content: friendlyError });
  }
}

module.exports = { SERIES_LISTS, TV_LIST_PATHS, data, execute, getSeriesFriendlyError, help };
