const {
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const {
  findRoleByName,
  formatRole,
} = require('../../services/guild');
const {
  KINGDOM_COLOR,
  LEANNE_USER_ID,
} = require('../../shared/constants');

const data = new SlashCommandBuilder()
  .setName('staff')
  .setDescription(
    "Meet the Kingdom's Supreme Royalty, admins, and moderators.",
  );

const help = {
  area: 'kingdom',
  usage: '/staff',
  summary: 'Meet Supreme Royalty, admins, and moderators.',
  audience: 'everyone',
  order: 20,
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
  const supremeRoyaltyRole = findRoleByName(guild, [
    'Supreme Royalty',
  ]);
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
    .setTitle('👑 Meet the Kingdom Team')
    .setDescription(
      'The live Discord role hierarchy determines staff authority. Relationship lore never grants permissions.',
    )
    .setThumbnail(
      guild.iconURL({ size: 256 }) ??
        interaction.client.user.displayAvatarURL({ size: 256 }),
    )
    .addFields(
      {
        name: '👑 Supreme Royalty',
        value: [
          formatRole(supremeRoyaltyRole, 'Supreme Royalty'),
          `<@${guild.ownerId}> — **Leonore**, Owner & Founder`,
          `<@${LEANNE_USER_ID}> — **Leanne**, Leonore’s Girlfriend & Royal Partner`,
          "Together, they represent the Kingdom's highest royal leadership.",
        ].join('\n'),
      },
      {
        name: '🛡️ Administrators',
        value: [
          formatRole(adminRole, 'Admin'),
          'Oversee server operations, structure, and escalated community concerns.',
        ].join('\n'),
      },
      {
        name: '⚖️ Moderators',
        value: [
          formatRole(moderatorRole, 'Moderator'),
          'Help enforce the rules and protect the Kingdom as a welcoming safe space.',
        ].join('\n'),
      },
    )
    .setFooter({
      text: 'Use the appropriate staff role when you need assistance.',
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
