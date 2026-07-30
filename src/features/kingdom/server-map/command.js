const { SlashCommandBuilder } = require('discord.js');

const {
  buildServerMapComponents,
} = require('./components');
const { buildServerMapEmbeds } = require('./map-builder');

const data = new SlashCommandBuilder()
  .setName('server-map')
  .setDescription(
    'Explore the server categories and channels you can access.',
  );

const help = {
  area: 'kingdom',
  usage: '/server-map',
  summary: 'Browse categories and channels you can access.',
  audience: 'everyone',
  order: 40,
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

  await interaction.deferReply();

  const embeds = buildServerMapEmbeds(
    interaction.guild,
    interaction.member,
  );

  await interaction.editReply({
    embeds: [embeds[0]],
    components: buildServerMapComponents(
      interaction.user.id,
      0,
      embeds.length,
    ),
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  data,
  execute,
  help,
};
