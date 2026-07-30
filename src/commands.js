const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check whether Leone is online and responsive.'),

  new SlashCommandBuilder().setName('help').setDescription('Display Leone command information.'),

  new SlashCommandBuilder().setName('about').setDescription('Display information about Leone.'),

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
            value: 'Display information about Leone.',
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
        .setColor(0x5865f2)
        .setTitle('About Leone')
        .setDescription('Leone is an intelligent Discord assistant designed to support server administration, automation, and community interaction.')
        .setThumbnail(botUser.displayAvatarURL({ size: 256 }))
        .addFields(
          {
            name: 'Status',
            value: 'Online',
            inline: true,
          },
          {
            name: 'Platform',
            value: 'Discord',
            inline: true,
          },
          {
            name: 'Runtime',
            value: 'Node.js',
            inline: true,
          },
        )
        .setFooter({
          text: `Bot ID: ${botUser.id}`,
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
