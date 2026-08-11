const { EmbedBuilder } = require('discord.js');

const ANIME_COLOR = 0x6f6bdc;
const JIKAN_URL = 'https://jikan.moe';
const ANILIST_URL = 'https://anilist.co';

function truncate(text, maximumLength) {
  if (!text) return 'No synopsis is available for this title.';
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function getAnimeTitle(anime) {
  return anime.title_english || anime.title || anime.title_japanese || 'Untitled anime';
}

function getAnimeGenres(anime) {
  return (anime.genres ?? [])
    .map((genre) => genre?.name)
    .filter(Boolean);
}

function safeAnime(results, limit = 5) {
  return (results ?? [])
    .filter(
      (anime) =>
        anime &&
        anime.mal_id &&
        (anime.title_english || anime.title || anime.title_japanese),
    )
    .slice(0, limit);
}

function createAnimeEmbed(anime, index = 0, options = {}) {
  const title = getAnimeTitle(anime);
  const numberedTitle = options.numbered === false
    ? title
    : `${index + 1}. ${title}`;
  const genres = getAnimeGenres(anime);
  const score = Number.isFinite(Number(anime.score))
    ? `⭐ ${Number(anime.score).toFixed(2)}/10`
    : 'Not scored';
  const imageUrl = anime.images?.jpg?.large_image_url ?? anime.images?.jpg?.image_url;
  const isAniList = anime.source === 'anilist';
  const embed = new EmbedBuilder()
    .setColor(ANIME_COLOR)
    .setAuthor({
      name: isAniList ? 'Anime data from AniList' : 'Anime data from Jikan / MyAnimeList',
      url: isAniList ? ANILIST_URL : JIKAN_URL,
    })
    .setTitle(numberedTitle)
    .setURL(anime.url ?? `${JIKAN_URL}/anime/${anime.mal_id}`)
    .setDescription(truncate(anime.synopsis, options.descriptionLimit ?? 600))
    .addFields(
      {
        name: 'Score',
        value: score,
        inline: true,
      },
      {
        name: 'Format',
        value: [anime.type, anime.episodes ? `${anime.episodes} episodes` : null]
          .filter(Boolean)
          .join(' • ') || 'Not listed',
        inline: true,
      },
      {
        name: 'Genres',
        value: genres.slice(0, 4).join(' • ') || 'Not listed',
        inline: true,
      },
    )
    .setFooter({
      text: isAniList
        ? 'Data provided through AniList.'
        : 'Data provided through Jikan; sourced from MyAnimeList.',
    });

  if (anime.rank) {
    embed.addFields({ name: 'Rank', value: `#${anime.rank}`, inline: true });
  }

  if (anime.status) {
    embed.addFields({ name: 'Status', value: anime.status, inline: true });
  }

  if (imageUrl) embed.setThumbnail(imageUrl);
  return embed;
}

module.exports = {
  ANIME_COLOR,
  ANILIST_URL,
  JIKAN_URL,
  createAnimeEmbed,
  getAnimeGenres,
  getAnimeTitle,
  safeAnime,
  truncate,
};
