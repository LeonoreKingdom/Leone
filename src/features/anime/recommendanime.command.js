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

const ANIME_GENRES = {
  action: { id: 1, label: 'Action' },
  adventure: { id: 2, label: 'Adventure' },
  comedy: { id: 4, label: 'Comedy' },
  drama: { id: 8, label: 'Drama' },
  fantasy: { id: 10, label: 'Fantasy' },
  romance: { id: 22, label: 'Romance' },
  sci_fi: { id: 24, label: 'Sci-Fi' },
  slice_of_life: { id: 36, label: 'Slice of Life' },
};

function configureAnimeSubcommand(subcommand) {
  return subcommand
    .setName('anime')
    .setDescription('Find personalized anime recommendations.')
    .addStringOption((option) =>
      option
        .setName('genre')
        .setDescription('Choose a preferred anime genre.')
        .addChoices(
          ...Object.entries(ANIME_GENRES).map(([value, genre]) => ({
            name: genre.label,
            value,
          })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Choose a format.')
        .addChoices(
          { name: 'TV', value: 'tv' },
          { name: 'Movie', value: 'movie' },
          { name: 'OVA', value: 'ova' },
          { name: 'ONA', value: 'ona' },
        ),
    )
    .addBooleanOption((option) =>
      option.setName('private').setDescription('Show recommendations only to you.'),
    );
}

function getFriendlyError(error) {
  if (!(error instanceof JikanError) && !(error instanceof AniListError)) return null;
  if (error.code === 'RATE_LIMIT') {
    return 'The anime catalog is receiving too many requests right now. Please try again shortly.';
  }
  if (error.code === 'INVALID_REQUEST') {
    return 'Those anime preferences are not valid. Please try again.';
  }
  if (['TIMEOUT', 'UNAVAILABLE', 'UPSTREAM', 'INVALID_RESPONSE'].includes(error.code)) {
    return 'The anime catalog is temporarily unavailable. Please try again later.';
  }
  return null;
}

/**
 * Runs the anime recommendation subcommand after the parent command has deferred.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeAnimeRecommendation(interaction) {
  try {
    const client = createJikanClient();
    const genre = interaction.options.getString('genre');
    const type = interaction.options.getString('type');
    const response = genre || type
      ? await searchAnimeWithFallback({
        jikanClient: client,
        query: '',
        page: 1,
        options: {
          genres: genre ? ANIME_GENRES[genre].id : undefined,
          type: type ?? undefined,
          order_by: 'score',
          sort: 'desc',
          limit: 5,
          fallback: {
            genre: genre ? ANIME_GENRES[genre].label : undefined,
            format: type,
            sort: 'desc',
          },
        },
      })
      : await client.listAnime('bypopularity', 1);
    const anime = safeAnime(response.data);

    if (anime.length === 0) {
      await interaction.editReply({
        content: 'I could not find anime matching those preferences. Try a broader choice.',
      });
      return;
    }

    const preferenceText = [
      genre ? ANIME_GENRES[genre].label : null,
      type ? type.toUpperCase() : null,
    ].filter(Boolean).join(' • ');
    await interaction.editReply({
      content: `✨ Leone’s anime picks${preferenceText ? ` for ${preferenceText}` : ''}. Open a title for details.`,
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
  ANIME_GENRES,
  configureAnimeSubcommand,
  executeAnimeRecommendation,
  getFriendlyError,
};
