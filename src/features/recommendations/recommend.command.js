const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const {
  KINGDOM_COLOR,
  TMDB_LOGO_URL,
  TMDB_URL,
} = require('../../shared/constants');
const {
  ERAS,
  GENRES,
  MOODS,
  RUNTIMES,
  buildDiscoverQuery,
  describeMatch,
  getMovieGenreLabels,
  selectMovies,
} = require('./movie-recommender');
const {
  TmdbError,
  createTmdbClient,
} = require('./tmdb-client');

const genreChoices = Object.entries(GENRES).map(
  ([value, genre]) => ({
    name: genre.label,
    value,
  }),
);
const moodChoices = Object.entries(MOODS).map(
  ([value, mood]) => ({
    name: mood.label,
    value,
  }),
);
const runtimeChoices = Object.entries(RUNTIMES).map(
  ([value, runtime]) => ({
    name: runtime.label,
    value,
  }),
);
const eraChoices = Object.entries(ERAS).map(
  ([value, era]) => ({
    name: era.label,
    value,
  }),
);

const data = new SlashCommandBuilder()
  .setName('recommend')
  .setDescription('Get personalized recommendations from Leone.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('movie')
      .setDescription(
        'Find three movies that fit your preferences.',
      )
      .addStringOption((option) =>
        option
          .setName('mood')
          .setDescription('What kind of mood should the movie fit?')
          .addChoices(...moodChoices),
      )
      .addStringOption((option) =>
        option
          .setName('genre')
          .setDescription('Choose a preferred movie genre.')
          .addChoices(...genreChoices),
      )
      .addStringOption((option) =>
        option
          .setName('runtime')
          .setDescription('Choose a preferred movie length.')
          .addChoices(...runtimeChoices),
      )
      .addStringOption((option) =>
        option
          .setName('language')
          .setDescription(
            'Filter by the movie’s original language.',
          )
          .addChoices(
            { name: 'English', value: 'en' },
            { name: 'Indonesian', value: 'id' },
            { name: 'Japanese', value: 'ja' },
            { name: 'Korean', value: 'ko' },
            { name: 'Chinese', value: 'zh' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('era')
          .setDescription('Choose a release period.')
          .addChoices(...eraChoices),
      )
      .addNumberOption((option) =>
        option
          .setName('minimum-rating')
          .setDescription(
            'Minimum TMDB community rating (0–10).',
          )
          .setMinValue(0)
          .setMaxValue(10),
      )
      .addBooleanOption((option) =>
        option
          .setName('private')
          .setDescription(
            'Show the recommendations only to you.',
          ),
      ),
  );

const help = {
  area: 'recommendations',
  usage: '/recommend movie [preferences]',
  summary:
    'Discover three TMDB movies matched to your preferences.',
  audience: 'everyone',
  order: 10,
};

function getLocale(interaction) {
  return interaction.locale?.toLowerCase().startsWith('id')
    ? 'id-ID'
    : 'en-US';
}

function truncate(text, maximumLength) {
  if (!text) {
    return 'No overview is available in the selected language.';
  }

  if (text.length <= maximumLength) {
    return text;
  }

  return `${text
    .slice(0, maximumLength - 1)
    .trimEnd()}…`;
}

function createMovieEmbed(movie, index, preferences) {
  const genres = getMovieGenreLabels(movie);
  const releaseYear = movie.release_date.slice(0, 4);
  const movieUrl = `${TMDB_URL}/movie/${movie.id}`;
  const embed = new EmbedBuilder()
    .setColor(KINGDOM_COLOR)
    .setAuthor({
      name: 'Movie data from TMDB',
      iconURL: TMDB_LOGO_URL,
      url: TMDB_URL,
    })
    .setTitle(
      `${index + 1}. ${movie.title} (${releaseYear})`,
    )
    .setURL(movieUrl)
    .setDescription(truncate(movie.overview, 900))
    .addFields(
      {
        name: 'Why Leone chose it',
        value: describeMatch(movie, preferences),
      },
      {
        name: 'TMDB rating',
        value:
          movie.vote_count > 0
            ? `⭐ ${Number(movie.vote_average).toFixed(
                1,
              )}/10 from ${Number(
                movie.vote_count,
              ).toLocaleString('en-US')} votes`
            : 'Not yet rated',
        inline: true,
      },
      {
        name: 'Genres',
        value:
          genres.length > 0
            ? genres.slice(0, 4).join(' • ')
            : 'Not listed',
        inline: true,
      },
    )
    .setFooter({
      text: 'Not endorsed or certified by TMDB',
    });

  if (movie.poster_path) {
    embed.setThumbnail(
      `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
    );
  }

  return embed;
}

function getFriendlyError(error) {
  if (!(error instanceof TmdbError)) {
    return null;
  }

  switch (error.code) {
    case 'CONFIGURATION':
      return 'Movie recommendations are not configured yet. A server administrator needs to add `TMDB_READ_ACCESS_TOKEN` or `TMDB_API_KEY` to Leone’s environment.';
    case 'AUTHENTICATION':
      return 'TMDB rejected Leone’s credential. A server administrator needs to check the configured token or API key.';
    case 'RATE_LIMIT':
      return 'TMDB is receiving too many requests right now. Please wait a moment and try again.';
    case 'TIMEOUT':
    case 'UNAVAILABLE':
    case 'UPSTREAM':
    case 'INVALID_RESPONSE':
      return 'TMDB is temporarily unavailable. Please try the command again later.';
    default:
      return null;
  }
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function execute(interaction) {
  const isPrivate =
    interaction.options.getBoolean('private') ?? false;

  if (isPrivate) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.deferReply();
  }

  const preferences = {
    mood: interaction.options.getString('mood'),
    genre: interaction.options.getString('genre'),
    runtime: interaction.options.getString('runtime'),
    originalLanguage:
      interaction.options.getString('language'),
    era: interaction.options.getString('era'),
    minimumRating:
      interaction.options.getNumber('minimum-rating'),
    locale: getLocale(interaction),
  };

  try {
    const client = createTmdbClient();
    const response = await client.discoverMovies(
      buildDiscoverQuery(preferences),
    );
    const movies = selectMovies(
      response.results ?? [],
      preferences,
    );

    if (movies.length === 0) {
      await interaction.editReply({
        content:
          'I could not find a suitable movie for those filters. Try lowering the minimum rating or removing one preference.',
      });
      return;
    }

    await interaction.editReply({
      content:
        '🎬 Here are Leone’s movie picks for you. Select a title to open its TMDB page.',
      embeds: movies.map((movie, index) =>
        createMovieEmbed(movie, index, preferences),
      ),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const friendlyError = getFriendlyError(error);

    if (!friendlyError) {
      throw error;
    }

    await interaction.editReply({
      content: friendlyError,
    });
  }
}

module.exports = {
  createMovieEmbed,
  data,
  execute,
  getFriendlyError,
  help,
};
