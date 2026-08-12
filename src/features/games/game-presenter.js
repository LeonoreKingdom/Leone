const { EmbedBuilder } = require('discord.js');

const GAME_COLOR = 0x4b77be;
const RAWG_URL = 'https://rawg.io';

function truncate(text, maximumLength) {
  if (!text) return 'No game description is available.';
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function safeGames(results, limit = 5) {
  return (results ?? [])
    .filter((game) => game && game.id && (game.name || game.slug))
    .slice(0, limit);
}

function labels(values, key = 'name') {
  return (values ?? [])
    .map((value) => typeof value === 'string' ? value : value?.[key])
    .filter(Boolean);
}

function gameUrl(game) {
  return game.url ?? `${RAWG_URL}/games/${game.slug ?? game.id}`;
}

function createGameEmbed(game, index = 0, options = {}) {
  const title = game.name ?? game.slug ?? 'Untitled game';
  const numberedTitle = options.numbered === false
    ? title
    : `${index + 1}. ${title}`;
  const platforms = labels(game.platforms?.map((entry) => entry.platform ?? entry));
  const genres = labels(game.genres);
  const rating = Number.isFinite(Number(game.rating))
    ? `⭐ ${Number(game.rating).toFixed(2)}/5`
    : 'Not rated';
  const embed = new EmbedBuilder()
    .setColor(GAME_COLOR)
    .setAuthor({ name: 'Game data from RAWG', url: RAWG_URL })
    .setTitle(numberedTitle)
    .setURL(gameUrl(game))
    .setDescription(truncate(game.description_raw ?? game.description, options.descriptionLimit ?? 700))
    .addFields(
      { name: 'Rating', value: rating, inline: true },
      { name: 'Release', value: game.released ?? 'Not listed', inline: true },
      { name: 'Platforms', value: platforms.slice(0, 4).join(' • ') || 'Not listed', inline: true },
      { name: 'Genres', value: genres.slice(0, 4).join(' • ') || 'Not listed', inline: true },
    )
    .setFooter({ text: 'Game metadata provided by RAWG. See the linked page for details.' });

  if (game.background_image) embed.setThumbnail(game.background_image);
  if (game.metacritic) {
    embed.addFields({ name: 'Metacritic', value: String(game.metacritic), inline: true });
  }
  return embed;
}

module.exports = {
  GAME_COLOR,
  RAWG_URL,
  createGameEmbed,
  gameUrl,
  safeGames,
};
