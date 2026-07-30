const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check whether Leone is online and responsive.'),

  new SlashCommandBuilder().setName('help').setDescription('Display Leone command information.'),

  new SlashCommandBuilder()
    .setName('about')
    .setDescription("Learn about Leonore's Kingdom and its royal companion, Leone."),

  new SlashCommandBuilder().setName('server').setDescription('Display information about this Discord server.'),
];

/**
 * Execute a registered slash command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeCommand(interaction) {
  switch (interaction.commandName) {
    case 'ping': {
      const responseLatency = Date.now() - interaction.createdTimestamp;

      const websocketLatency = Math.round(interaction.client.ws.ping);

      await interaction.reply({
        content: ['Leone is online.', `Response latency: **${responseLatency} ms**`, `WebSocket latency: **${websocketLatency} ms**`].join('\n'),
      });

      break;
    }

    case 'help': {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Leone Commands')
        .setDescription('Available commands for the Leone Discord assistant.')
        .addFields(
          {
            name: '/ping',
            value: 'Check Leone response and WebSocket latency.',
          },
          {
            name: '/help',
            value: 'Display this command list.',
          },
          {
            name: '/about',
            value: "Learn about Leonore's Kingdom and its royal companion, Leone.",
          },
          {
            name: '/server',
            value: 'Display information about the current server.',
          },
        )
        .setFooter({
          text: 'Leone • AI Assistant Bot',
        });

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'about': {
      const botUser = interaction.client.user;

      const embed = new EmbedBuilder()
        .setColor(0x1b2a4e)
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
              'Founded and led by **Leonore**, with **Leanne—her beloved partner—beside her**.',
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

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'server': {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: 'This command can only be used inside a server.',
        });

        return;
      }

      const guild = interaction.guild;
      const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(guild.name)
        .setThumbnail(
          guild.iconURL({ size: 256 }) ??
            interaction.client.user.displayAvatarURL({
              size: 256,
            }),
        )
        .addFields(
          {
            name: 'Members',
            value: String(guild.memberCount),
            inline: true,
          },
          {
            name: 'Channels',
            value: String(guild.channels.cache.size),
            inline: true,
          },
          {
            name: 'Roles',
            value: String(guild.roles.cache.size),
            inline: true,
          },
          {
            name: 'Owner',
            value: `<@${guild.ownerId}>`,
            inline: true,
          },
          {
            name: 'Created',
            value: `<t:${createdTimestamp}:D>`,
            inline: true,
          },
          {
            name: 'Server ID',
            value: guild.id,
            inline: true,
          },
        );

      await interaction.reply({ embeds: [embed] });
      break;
    }

    default:
      throw new Error(`Unsupported command: ${interaction.commandName}`);
  }
}

module.exports = {
  commands,
  executeCommand,
};
