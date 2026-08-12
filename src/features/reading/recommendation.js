const { createAniListMediaClient, AniListMediaError } = require('./anilist-media-client');
const { createReadingEmbed, safeReading } = require('./reading-presenter');

const READING_GENRES = [
  { name: 'Action', value: 'Action' },
  { name: 'Adventure', value: 'Adventure' },
  { name: 'Comedy', value: 'Comedy' },
  { name: 'Drama', value: 'Drama' },
  { name: 'Fantasy', value: 'Fantasy' },
  { name: 'Mystery', value: 'Mystery' },
  { name: 'Romance', value: 'Romance' },
  { name: 'Sci-Fi', value: 'Sci-Fi' },
  { name: 'Slice of Life', value: 'Slice of Life' },
];

function configureReadingRecommendationSubcommand(subcommand, config) {
  return subcommand
    .setName(config.name)
    .setDescription(`Find personalized ${config.label.toLowerCase()} recommendations.`)
    .addStringOption((option) => option
      .setName('genre')
      .setDescription(`Choose a preferred ${config.label.toLowerCase()} genre.`)
      .addChoices(...READING_GENRES))
    .addBooleanOption((option) => option
      .setName('private')
      .setDescription('Show recommendations only to you.'));
}

async function executeReadingRecommendation(interaction, config) {
  const genre = interaction.options.getString('genre');
  const client = createAniListMediaClient();
  const response = await client.listMedia({
    page: 1,
    perPage: 20,
    format: config.format,
    country: config.country,
    genre,
    sort: 'POPULARITY_DESC',
  });
  const items = safeReading(response.data, 3);
  if (items.length === 0) {
    await interaction.editReply({ content: `I could not find ${config.label.toLowerCase()} titles matching those preferences. Try a broader choice.` });
    return;
  }
  await interaction.editReply({
    content: `📚 Leone’s ${config.label.toLowerCase()} picks${genre ? ` for ${genre}` : ''}. Open a title to view details.`,
    embeds: items.map((item, index) => createReadingEmbed(item, index, config)),
    allowedMentions: { parse: [] },
  });
}

function friendlyReadingError(error) {
  if (!(error instanceof AniListMediaError)) return null;
  if (error.code === 'RATE_LIMIT') return 'AniList is receiving too many requests right now. Please try again shortly.';
  if (['TIMEOUT', 'UNAVAILABLE', 'UPSTREAM', 'INVALID_RESPONSE'].includes(error.code)) return 'The reading catalog is temporarily unavailable. Please try again later.';
  return null;
}

module.exports = {
  READING_GENRES,
  configureReadingRecommendationSubcommand,
  executeReadingRecommendation,
  friendlyReadingError,
};
