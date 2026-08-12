const { MessageFlags } = require('discord.js');
const { createTmdbClient, TmdbError } = require('../recommendations/tmdb-client');
const { createSeriesEmbed, safeSeries } = require('./series-presenter');

const SERIES_GENRES = {
  action_adventure: { label: 'Action & adventure', id: 10759 },
  animation: { label: 'Animation', id: 16 },
  comedy: { label: 'Comedy', id: 35 },
  crime: { label: 'Crime', id: 80 },
  drama: { label: 'Drama', id: 18 },
  mystery: { label: 'Mystery', id: 9648 },
  romance: { label: 'Romance', id: 10749 },
  sci_fi_fantasy: { label: 'Sci-fi & fantasy', id: 10765 },
};

function configureSeriesRecommendationSubcommand(subcommand) {
  return subcommand
    .setName('series')
    .setDescription('Find personalized TV series recommendations.')
    .addStringOption((option) => option
      .setName('genre')
      .setDescription('Choose a preferred series genre.')
      .addChoices(...Object.entries(SERIES_GENRES).map(([value, item]) => ({ name: item.label, value }))))
    .addNumberOption((option) => option
      .setName('minimum-rating')
      .setDescription('Minimum TMDB community rating (0–10).')
      .setMinValue(0)
      .setMaxValue(10))
    .addBooleanOption((option) => option
      .setName('private')
      .setDescription('Show recommendations only to you.'));
}

async function executeSeriesRecommendation(interaction) {
  const genre = interaction.options.getString('genre');
  const minimumRating = interaction.options.getNumber('minimum-rating');
  const language = interaction.locale?.toLowerCase().startsWith('id') ? 'id-ID' : 'en-US';
  const client = createTmdbClient();
  const response = await client.discoverTv({
    language,
    page: 1,
    include_adult: false,
    sort_by: 'popularity.desc',
    'vote_count.gte': 100,
    'vote_average.gte': minimumRating ?? undefined,
    with_genres: genre ? SERIES_GENRES[genre].id : undefined,
  });
  const series = safeSeries(response.results, 3);
  if (series.length === 0) {
    await interaction.editReply({ content: 'I could not find series matching those preferences. Try a broader choice.' });
    return;
  }
  const preferenceText = [genre ? SERIES_GENRES[genre].label : null, minimumRating ? `rating ${minimumRating}+` : null].filter(Boolean).join(' • ');
  await interaction.editReply({
    content: `📺 Leone’s series picks${preferenceText ? ` for ${preferenceText}` : ''}. Open a title to view details.`,
    embeds: series.map((item, index) => createSeriesEmbed(item, index)),
    allowedMentions: { parse: [] },
  });
}

function friendlySeriesError(error) {
  if (!(error instanceof TmdbError)) return null;
  if (error.code === 'CONFIGURATION') return 'Series recommendations are not configured yet. Add `TMDB_READ_ACCESS_TOKEN` or `TMDB_API_KEY` to Leone’s environment.';
  if (error.code === 'AUTHENTICATION') return 'TMDB rejected Leone’s credential. Please check the configured token or API key.';
  if (error.code === 'RATE_LIMIT') return 'TMDB is receiving too many requests right now. Please try again shortly.';
  if (['TIMEOUT', 'UNAVAILABLE', 'UPSTREAM', 'INVALID_RESPONSE'].includes(error.code)) return 'The series catalog is temporarily unavailable. Please try again later.';
  return null;
}

module.exports = {
  SERIES_GENRES,
  configureSeriesRecommendationSubcommand,
  executeSeriesRecommendation,
  friendlySeriesError,
};
