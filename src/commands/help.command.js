const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const { KINGDOM_COLOR } = require('../shared/constants');
const { areas } = require('./areas');

const areaChoices = Object.values(areas)
  .sort((left, right) => left.order - right.order)
  .map((area) => ({
    name: `${area.emoji} ${area.label}`,
    value: area.id,
  }));

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Explore Leone commands by feature area.')
  .addStringOption((option) =>
    option
      .setName('area')
      .setDescription('Show commands from one feature area.')
      .setRequired(false)
      .addChoices(...areaChoices),
  );

const help = {
  area: 'utility',
  usage: '/help area:<optional>',
  summary: 'Explore available commands by feature area.',
  audience: 'everyone',
  order: 10,
};

/**
 * @param {{help: {audience: string}}} command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
function isVisibleToMember(command, interaction) {
  if (command.help.audience !== 'staff') {
    return true;
  }

  return Boolean(
    interaction.inGuild() &&
      (interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
      ) ||
        interaction.memberPermissions?.has(
          PermissionFlagsBits.ModerateMembers,
        )),
  );
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{commandModules: Array<object>}} context
 */
async function execute(interaction, context) {
  const selectedArea =
    interaction.options.getString('area') ?? null;
  const visibleCommands = context.commandModules
    .filter(
      (command) =>
        command.help &&
        isVisibleToMember(command, interaction),
    )
    .sort(
      (left, right) =>
        areas[left.help.area].order -
          areas[right.help.area].order ||
        left.help.order - right.help.order,
    );
  const areaIds = [
    ...new Set(
      visibleCommands.map((command) => command.help.area),
    ),
  ].filter((areaId) => !selectedArea || areaId === selectedArea);
  const embed = new EmbedBuilder().setColor(KINGDOM_COLOR);

  if (selectedArea) {
    const area = areas[selectedArea];

    embed
      .setTitle(`${area.emoji} Leone Help — ${area.label}`)
      .setDescription(area.description);
  } else {
    embed
      .setTitle('👑 Leone — Command Areas')
      .setDescription(
        'Choose an area with `/help area:<area>` for a focused command guide.',
      );
  }

  for (const areaId of areaIds) {
    const area = areas[areaId];
    const areaCommands = visibleCommands.filter(
      (command) => command.help.area === areaId,
    );
    const value = [
      selectedArea ? null : area.description,
      ...areaCommands.map(
        (command) =>
          `\`${command.help.usage}\` — ${command.help.summary}`,
      ),
    ]
      .filter(Boolean)
      .join('\n');

    embed.addFields({
      name: `${area.emoji} ${area.label}`,
      value,
    });
  }

  if (areaIds.length === 0) {
    embed
      .setTitle('Leone Help')
      .setDescription(
        'No commands are available in that area for your current context.',
      );
  }

  embed.setFooter({
    text: "Leone • Royal Companion of Leonore's Kingdom",
  });

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  data,
  execute,
  help,
};
