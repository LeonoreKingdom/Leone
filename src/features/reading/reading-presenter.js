const { EmbedBuilder } = require('discord.js');

const READING_COLOR = 0xb45f9b;
const ANILIST_URL = 'https://anilist.co';

function truncate(text, maximumLength) {
  if (!text) return 'No synopsis is available for this title.';
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function safeReading(results, limit = 5) {
  return (results ?? [])
    .filter((item) => item && item.id && (item.title || item.title_english || item.title_japanese))
    .slice(0, limit);
}

function readingTitle(item) {
  return item.title_english || item.title || item.title_japanese || 'Untitled reading';
}

function createReadingEmbed(item, index = 0, config = {}, options = {}) {
  const title = readingTitle(item);
  const numberedTitle = options.numbered === false ? title : `${index + 1}. ${title}`;
  const score = Number.isFinite(Number(item.score)) ? `⭐ ${Number(item.score).toFixed(1)}/10` : 'Not scored';
  const genres = (item.genres ?? []).map((genre) => genre?.name).filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor(READING_COLOR)
    .setAuthor({ name: `${config.label ?? 'Reading'} data from AniList`, url: ANILIST_URL })
    .setTitle(numberedTitle)
    .setURL(item.url ?? `${ANILIST_URL}/manga/${item.id}`)
    .setDescription(truncate(item.synopsis, options.descriptionLimit ?? 650))
    .addFields(
      { name: 'Score', value: score, inline: true },
      { name: 'Format', value: item.format ?? config.label ?? 'Not listed', inline: true },
      { name: 'Status', value: item.status ?? 'Not listed', inline: true },
      { name: 'Genres', value: genres.slice(0, 4).join(' • ') || 'Not listed', inline: true },
    )
    .setFooter({ text: 'Data provided through AniList.' });

  if (item.volumes) embed.addFields({ name: 'Volumes', value: String(item.volumes), inline: true });
  if (item.chapters) embed.addFields({ name: 'Chapters', value: String(item.chapters), inline: true });
  if (item.startDate) embed.addFields({ name: 'Started', value: item.startDate, inline: true });
  if (item.images?.jpg?.large_image_url) embed.setThumbnail(item.images.jpg.large_image_url);
  return embed;
}

module.exports = {
  ANILIST_URL,
  READING_COLOR,
  createReadingEmbed,
  readingTitle,
  safeReading,
};
