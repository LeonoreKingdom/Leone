const {
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const {
  createMovieEmbed,
  getFriendlyError,
} = require('./recommend.command');
const {
  getMovieGenreLabels,
} = require('./movie-recommender');
const {
  createTmdbClient,
  TmdbError,
} = require('./tmdb-client');

const MOVIE_LISTS = {
  popular: 'Popular',
  now_playing: 'Now playing',
  upcoming: 'Upcoming',
  top_rated: 'Top rated',
};

const listChoices = Object.entries(MOVIE_LISTS).map(
  ([value, name]) => ({ name, value }),
);

const data = new SlashCommandBuilder()
  .setName('movie')
  .setDescription('Browse, search, and inspect movies from TMDB.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('Browse a TMDB movie catalog.')
      .addStringOption((option) =>
        option
          .setName('category')
          .setDescription('Which movie catalog should Leone show?')
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
        option
          .setName('private')
          .setDescription('Show the results only to you.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('search')
      .setDescription('Search the TMDB movie catalog by title.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Movie title or keywords to search for.')
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
        option
          .setName('private')
          .setDescription('Show the results only to you.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('details')
      .setDescription('Show details for a TMDB movie ID.')
      .addIntegerOption((option) =>
        option
          .setName('movie-id')
          .setDescription('The numeric TMDB movie ID.')
          .setMinValue(1)
          .setMaxValue(2147483647)
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName('private')
          .setDescription('Show the details only to you.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('trending')
      .setDescription('Show movies trending on TMDB.')
      .addStringOption((option) =>
        option
          .setName('period')
          .setDescription('How far back should the trend be measured?')
          .addChoices(
            { name: 'Today', value: 'day' },
            { name: 'This week', value: 'week' },
          ),
      )
      .addBooleanOption((option) =>
        option
          .setName('private')
          .setDescription('Show the results only to you.'),
      ),
  );

const help = {
  area: 'movies',
  usage: '/movie <list|search|details|trending>',
  summary: 'Browse catalogs, search titles, inspect details, and see trends.',
  audience: 'everyone',
  order: 10,
};

function getLocale(interaction) {
  return interaction.locale?.toLowerCase().startsWith('id')
    ? 'id-ID'
    : 'en-US';
}

function getPage(interaction) {
  return interaction.options.getInteger('page') ?? 1;
}

function getPrivate(interaction) {
  return interaction.options.getBoolean('private') ?? false;
}

function safeMovies(results, limit = 5) {
  return (results ?? [])
    .filter(
      (movie) =>
        movie &&
        !movie.adult &&
        movie.id &&
        (movie.title || movie.name),
    )
    .slice(0, limit);
}

function createCatalogEmbeds(movies) {
  return movies.map((movie, index) =>
    createMovieEmbed(
      movie,
      index,
      {},
      { descriptionLimit: 650 },
    ),
  );
}

function createDetailsEmbed(movie) {
  const embed = createMovieEmbed(
    movie,
    0,
    {},
    { descriptionLimit: 1200, numbered: false },
  );
  const details = [
    movie.runtime ? `Runtime: ${movie.runtime} minutes` : null,
    movie.status ? `Status: ${movie.status}` : null,
    movie.original_language
      ? `Original language: ${movie.original_language.toUpperCase()}`
      : null,
  ].filter(Boolean);
  const genres = getMovieGenreLabels(movie);

  if (details.length > 0) {
    embed.addFields({
      name: 'Details',
      value: details.join('\n'),
      inline: true,
    });
  }

  if (genres.length > 0) {
    embed.addFields({
      name: 'Genres',
      value: genres.slice(0, 6).join(' • '),
      inline: true,
    });
  }

  if (movie.tagline) {
    embed.addFields({
      name: 'Tagline',
      value: movie.tagline.slice(0, 1024),
    });
  }

  return embed;
}

function getInvalidRequestMessage(error) {
  if (error instanceof TmdbError && error.code === 'INVALID_REQUEST') {
    return 'That movie request is not valid. Please check the selected options and try again.';
  }

  return null;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const isPrivate = getPrivate(interaction);

  await interaction.deferReply(
    isPrivate ? { flags: MessageFlags.Ephemeral } : undefined,
  );

  try {
    const client = createTmdbClient();
    const language = getLocale(interaction);

    if (subcommand === 'details') {
      const movie = await client.getMovieDetails(
        interaction.options.getInteger('movie-id'),
        { language },
      );

      await interaction.editReply({
        embeds: [createDetailsEmbed(movie)],
        allowedMentions: { parse: [] },
      });
      return;
    }

    let response;
    let heading;

    if (subcommand === 'search') {
      const query = interaction.options.getString('query', true).trim();
      const page = getPage(interaction);
      response = await client.searchMovies(query, {
        language,
        page,
      });
      heading = `Search results for “${query}”`;
    } else if (subcommand === 'trending') {
      const period = interaction.options.getString('period') ?? 'week';
      response = await client.trendingMovies(period, { language });
      heading = `Movies trending ${period === 'day' ? 'today' : 'this week'}`;
    } else {
      const category = interaction.options.getString('category') ?? 'popular';
      const page = getPage(interaction);
      response = await client.listMovies(category, {
        language,
        page,
        include_adult: false,
      });
      heading = `${MOVIE_LISTS[category]} movies`;
    }

    const movies = safeMovies(response.results);

    if (movies.length === 0) {
      await interaction.editReply({
        content: 'I could not find any movies for that request. Try another title or catalog.',
      });
      return;
    }

    const pageText = response.page && response.total_pages
      ? ` • Page ${response.page} of ${Math.min(response.total_pages, 500)}`
      : '';
    await interaction.editReply({
      content: `🎬 ${heading}${pageText}. Open a title to view its TMDB page.`,
      embeds: createCatalogEmbeds(movies),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const friendlyError =
      getInvalidRequestMessage(error) ?? getFriendlyError(error);

    if (!friendlyError) {
      throw error;
    }

    await interaction.editReply({ content: friendlyError });
  }
}

module.exports = {
  MOVIE_LISTS,
  createDetailsEmbed,
  data,
  execute,
  help,
  safeMovies,
};
