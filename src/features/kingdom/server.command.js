const {
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('server')
  .setDescription('Display information about this Discord server.');

const help = {
  area: 'kingdom',
  usage: '/server',
  summary: 'View live information about the current server.',
  audience: 'everyone',
  order: 50,
};

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
    });

    return;
  }

  const guild = interaction.guild;
  const createdTimestamp = Math.floor(
    guild.createdTimestamp / 1000,
  );
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(guild.name)
    .setThumbnail(
      guild.iconURL({ size: 256 }) ??
        interaction.client.user.displayAvatarURL({ size: 256 }),
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

  await interaction.reply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  data,
  execute,
  help,
};
