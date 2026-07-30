const {
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const {
  canViewChannel,
  findRoleByName,
  formatRole,
} = require('../../services/guild');
const { KINGDOM_COLOR } = require('../../shared/constants');

const data = new SlashCommandBuilder()
  .setName('rules')
  .setDescription(
    "Find Leonore's Kingdom official rules and community guidelines.",
  );

const help = {
  area: 'kingdom',
  usage: '/rules',
  summary: 'Find the official rules and community guidelines.',
  audience: 'everyone',
  order: 30,
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember} member
 */
function findRulesChannel(guild, member) {
  const configuredRulesChannel = guild.rulesChannelId
    ? guild.channels.cache.get(guild.rulesChannelId)
    : null;

  if (
    configuredRulesChannel &&
    canViewChannel(configuredRulesChannel, member)
  ) {
    return configuredRulesChannel;
  }

  return [...guild.channels.cache.values()]
    .filter(
      (channel) =>
        channel.type !== ChannelType.GuildCategory &&
        canViewChannel(channel, member) &&
        (channel.name.toLowerCase().includes('rule') ||
          channel.name.toLowerCase().includes('guideline')),
    )
    .sort(
      (left, right) =>
        left.rawPosition - right.rawPosition ||
        left.name.localeCompare(right.name),
    )[0];
}

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
  const rulesChannel = findRulesChannel(
    guild,
    interaction.member,
  );
  const adminRole = findRoleByName(guild, [
    'Admin',
    'Administrator',
  ]);
  const moderatorRole = findRoleByName(guild, [
    'Moderator',
    'Mod',
  ]);
  const embed = new EmbedBuilder()
    .setColor(KINGDOM_COLOR)
    .setTitle('📜 Kingdom Rules');

  if (rulesChannel) {
    embed
      .setDescription(
        `The official rules for **${guild.name}** are published in <#${rulesChannel.id}>.`,
      )
      .addFields({
        name: 'Before participating',
        value: [
          'Please read the complete rules in that channel.',
          'By participating, every citizen is expected to respect the community and help protect its safe-space values.',
        ].join('\n'),
      });
  } else {
    embed
      .setDescription(
        'I could not find a rules channel that is currently visible to you.',
      )
      .addFields({
        name: 'Need help?',
        value: `Please contact ${formatRole(adminRole, 'Admin')} or ${formatRole(moderatorRole, 'Moderator')} for the official guidelines.`,
      });
  }

  embed.setFooter({
    text: 'Canonical rules come from the server, not generated text.',
  });

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
