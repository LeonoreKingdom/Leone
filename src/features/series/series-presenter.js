const { EmbedBuilder } = require('discord.js');

const SERIES_COLOR = 0x8a5bb8;
const TMDB_URL = 'https://www.themoviedb.org';
const TMDB_LOGO_URL = 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg';

function truncate(text, maximumLength) {
  if (!text) return 'No series overview is available.';
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function safeSeries(results, limit = 5) {
  return (results ?? [])
    .filter((series) => series && series.id && (series.name || series.original_name))
    .slice(0, limit);
}

function getSeriesGenres(series) {
  return (series.genres ?? series.genre_ids ?? [])
    .map((genre) => typeof genre === 'string' ? genre : genre?.name ?? String(genre))
    .filter(Boolean);
}

function createSeriesEmbed(series, index = 0, options = {}) {
  const title = series.name ?? series.original_name ?? 'Untitled series';
  const firstAirDate = series.first_air_date ?? '';
  const year = firstAirDate.slice(0, 4) || 'TBA';
  const numberedTitle = options.numbered === false ? `${title} (${year})` : `${index + 1}. ${title} (${year})`;
  const embed = new EmbedBuilder()
    .setColor(SERIES_COLOR)
    .setAuthor({ name: 'Series data from TMDB', iconURL: TMDB_LOGO_URL, url: TMDB_URL })
    .setTitle(numberedTitle)
    .setURL(`${TMDB_URL}/tv/${series.id}`)
    .setDescription(truncate(series.overview, options.descriptionLimit ?? 700))
    .addFields(
      { name: 'TMDB rating', value: series.vote_count > 0 ? `⭐ ${Number(series.vote_average).toFixed(1)}/10` : 'Not yet rated', inline: true },
      { name: 'First aired', value: firstAirDate || 'Not listed', inline: true },
      { name: 'Seasons', value: series.number_of_seasons ? String(series.number_of_seasons) : 'Not listed', inline: true },
      { name: 'Genres', value: getSeriesGenres(series).slice(0, 4).join(' • ') || 'Not listed', inline: true },
    )
    .setFooter({ text: 'Not endorsed or certified by TMDB.' });

  if (series.poster_path) embed.setThumbnail(`https://image.tmdb.org/t/p/w500${series.poster_path}`);
  if (series.status) embed.addFields({ name: 'Status', value: series.status, inline: true });
  if (series.number_of_episodes) embed.addFields({ name: 'Episodes', value: String(series.number_of_episodes), inline: true });
  return embed;
}

module.exports = {
  SERIES_COLOR,
  createSeriesEmbed,
  getSeriesGenres,
  safeSeries,
};
