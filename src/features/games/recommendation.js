const { createGameEmbed, safeGames } = require('./game-presenter');
const { createRawgClient, RawgError } = require('./rawg-client');

const GAME_GENRES = {
  action: { label: 'Action', value: 'action' },
  adventure: { label: 'Adventure', value: 'adventure' },
  indie: { label: 'Indie', value: 'indie' },
  rpg: { label: 'Role-playing', value: 'role-playing-games-rpg' },
  strategy: { label: 'Strategy', value: 'strategy' },
  shooter: { label: 'Shooter', value: 'shooter' },
  sports: { label: 'Sports', value: 'sports' },
};

const GAME_MODES = {
  multiplayer: { label: 'Multiplayer', tag: 'multiplayer' },
  coop: { label: 'Co-op', tag: 'co-op' },
  singleplayer: { label: 'Single-player', tag: 'singleplayer' },
};

function configureGameRecommendationSubcommand(subcommand) {
  return subcommand
    .setName('game')
    .setDescription('Find personalized game recommendations.')
    .addStringOption((option) => option
      .setName('genre')
      .setDescription('Choose a preferred game genre.')
      .addChoices(...Object.entries(GAME_GENRES).map(([value, item]) => ({ name: item.label, value }))))
    .addStringOption((option) => option
      .setName('mode')
      .setDescription('Choose a preferred play style.')
      .addChoices(...Object.entries(GAME_MODES).map(([value, item]) => ({ name: item.label, value }))))
    .addBooleanOption((option) => option
      .setName('private')
      .setDescription('Show recommendations only to you.'));
}

function friendlyGameError(error) {
  if (!(error instanceof RawgError)) return null;
  if (error.code === 'CONFIGURATION') return 'Game recommendations are not configured yet. Add `RAWG_API_KEY` to Leone’s environment.';
  if (error.code === 'AUTHENTICATION') return 'RAWG rejected Leone’s API key. Please check the configured credential.';
  if (error.code === 'RATE_LIMIT') return 'RAWG is receiving too many requests right now. Please try again shortly.';
  if (['TIMEOUT', 'UNAVAILABLE', 'UPSTREAM', 'INVALID_RESPONSE'].includes(error.code)) return 'The game catalog is temporarily unavailable. Please try again later.';
  return null;
}

async function executeGameRecommendation(interaction) {
  const genre = interaction.options.getString('genre');
  const mode = interaction.options.getString('mode');
  const client = createRawgClient();
  const response = await client.listGames({
    page: 1,
    pageSize: 10,
    ordering: '-rating',
    genres: genre ? GAME_GENRES[genre].value : undefined,
    tags: mode ? GAME_MODES[mode].tag : undefined,
  });
  const games = safeGames(response.results, 3);
  if (games.length === 0) {
    await interaction.editReply({ content: 'I could not find games matching those preferences. Try a broader choice.' });
    return;
  }
  const preferences = [genre ? GAME_GENRES[genre].label : null, mode ? GAME_MODES[mode].label : null].filter(Boolean).join(' • ');
  await interaction.editReply({
    content: `🎮 Leone’s game picks${preferences ? ` for ${preferences}` : ''}. Open a title to view details.`,
    embeds: games.map((game, index) => createGameEmbed(game, index)),
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  GAME_GENRES,
  GAME_MODES,
  configureGameRecommendationSubcommand,
  executeGameRecommendation,
  friendlyGameError,
};
