const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const { KINGDOM_COLOR } = require('../../../shared/constants');

const data = new SlashCommandBuilder()
  .setName('server-stats')
  .setDescription('View live member and presence statistics for this server.');

const help = {
  area: 'kingdom',
  usage: '/server-stats',
  summary: 'View live member, online, and featured profile statistics.',
  audience: 'everyone',
  order: 45,
};

function fallbackStats(interaction) {
  const guild = interaction.guild;
  const onlineCount = guild.onlineMemberCount ?? guild.presences?.cache?.size ?? null;
  return {
    guildId: guild.id,
    name: guild.name,
    memberCount: guild.memberCount ?? null,
    onlineCount,
    iconUrl: guild.iconURL?.({ size: 256 }) ?? null,
    profiles: [{
      id: guild.ownerId,
      displayName: 'Guild owner',
      profileUrl: `https://discord.com/users/${guild.ownerId}`,
      avatarUrl: null,
    }],
    updatedAt: new Date().toISOString(),
  };
}

async function execute(interaction, context = {}) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command can only be used inside a server.' });
    return;
  }

  await interaction.deferReply();
  const stats = context.serverStats
    ? await context.serverStats.get(interaction.guildId)
    : fallbackStats(interaction);
  const online = stats.onlineCount == null ? 'Unavailable' : stats.onlineCount.toLocaleString();
  const memberCount = stats.memberCount == null ? 'Unavailable' : stats.memberCount.toLocaleString();
  const profiles = stats.profiles?.slice(0, 5).map((profile) =>
    `[${profile.displayName}](${profile.profileUrl})`,
  ).join(' • ');
  const embed = new EmbedBuilder()
    .setColor(KINGDOM_COLOR)
    .setTitle(`📊 ${stats.name} — Live statistics`)
    .setThumbnail(stats.iconUrl ?? interaction.client.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Members', value: memberCount, inline: true },
      { name: 'Online now', value: online, inline: true },
      { name: 'Updated', value: `<t:${Math.floor(new Date(stats.updatedAt).getTime() / 1000)}:R>`, inline: true },
    );
  if (profiles) embed.addFields({ name: 'Featured public profiles', value: profiles });
  embed.setFooter({ text: 'Presence totals are approximate when supplied by Discord.' });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

module.exports = { data, execute, fallbackStats, help };
