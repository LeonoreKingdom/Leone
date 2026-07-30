const {
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const {
  KINGDOM_COLOR,
  LEANNE_USER_ID,
  TMDB_LOGO_URL,
  TMDB_URL,
} = require('../../shared/constants');

const data = new SlashCommandBuilder()
  .setName('about')
  .setDescription(
    "Learn about Leonore's Kingdom and its royal companion, Leone.",
  );

const help = {
  area: 'kingdom',
  usage: '/about',
  summary: "Discover the Kingdom's identity and meet Leone.",
  audience: 'everyone',
  order: 10,
};

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function execute(interaction) {
  const botUser = interaction.client.user;
  const embed = new EmbedBuilder()
    .setColor(KINGDOM_COLOR)
    .setTitle("👑 Leonore's Kingdom")
    .setDescription(
      [
        '**Home for Talented People, Safe Space for Citizen**',
        '',
        '**WE BELONG TOGETHER**',
        '> *"It\'s not just a community, it\'s a palace to reach your dreams and ur safe haven~"*',
      ].join('\n'),
    )
    .setThumbnail(botUser.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: '✨ Our traits',
        value: [
          '🎨 **Talented** — A home for people to create, play, share, and shine.',
          '🧠 **Growth mindset** — Learn together and keep becoming better.',
          '🛡️ **Safe space** — A welcoming haven where every citizen can belong.',
        ].join('\n'),
      },
      {
        name: '🎮 Games in the Kingdom',
        value: [
          'Mobile Legends: Bang Bang • Dota 2 • Genshin Impact',
          'Roblox • Valorant • Honkai: Star Rail • osu!',
        ].join('\n'),
      },
      {
        name: '💙 The heart of the Kingdom',
        value: [
          `Founded and led by **Leonore**, with <@${LEANNE_USER_ID}> — **Leanne, his beloved girlfriend and royal partner** — beside him.`,
          'The staff team helps protect our safe space and keeps the Kingdom welcoming and organized.',
        ].join('\n'),
      },
      {
        name: '🤖 Meet Leone',
        value: [
          "I'm the Kingdom's royal companion and guide.",
          'As I grow, I will help members navigate the server, meet the staff, build social bonds, discover games and movies, research technical topics, join activities, and support community safety.',
        ].join(' '),
      },
      {
        name: 'Start exploring',
        value: 'Use `/help` to see what Leone can do today.',
      },
    )
    .setFooter({
      text: "Leone • Royal Companion of Leonore's Kingdom",
    });
  const creditsEmbed = new EmbedBuilder()
    .setColor(0x01b4e4)
    .setTitle('Movie data credit')
    .setURL(TMDB_URL)
    .setDescription(
      [
        `[TMDB — The Movie Database](${TMDB_URL})`,
        '',
        'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      ].join('\n'),
    )
    .setThumbnail(TMDB_LOGO_URL);

  await interaction.reply({
    embeds: [embed, creditsEmbed],
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  data,
  execute,
  help,
};
