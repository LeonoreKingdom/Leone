const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const { KINGDOM_COLOR } = require('../../../shared/constants');

const data = new SlashCommandBuilder()
  .setName('server-stats')
  .setDescription('View live member and presence statistics for this server.');

const help = {
  area: 'kingdom',
  usage: '/server-stats',
  summary: 'View live member, role, voice, bot, and featured profile statistics.',
  audience: 'everyone',
  order: 45,
};

function fallbackStats(interaction) {
  const guild = interaction.guild;
  const members = guild.members?.cache ? [...guild.members.cache.values()] : [];
  const citizenRole = guild.roles?.cache?.find((role) => role.name?.toLocaleLowerCase() === 'citizen');
  const onlineCount = guild.onlineMemberCount ?? guild.presences?.cache?.size ?? null;
  return {
    guildId: guild.id,
    name: guild.name,
    memberCount: guild.memberCount ?? null,
    citizenCount: citizenRole && guild.members?.cache
      ? members.filter((member) => member.roles?.cache?.has(citizenRole.id) || member.roles?.includes(citizenRole.id)).length
      : null,
    onlineCount,
    inVoiceCount: guild.voiceStates?.cache
      ? [...guild.voiceStates.cache.values()].filter((state) => state.channelId).length
      : null,
    botCount: guild.members?.cache
      ? members.filter((member) => member.user?.bot).length
      : null,
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
  const format = (value) => value == null ? 'Unavailable' : value.toLocaleString();
  const memberCount = format(stats.memberCount);
  const citizenCount = format(stats.citizenCount);
  const online = format(stats.onlineCount);
  const inVoiceCount = format(stats.inVoiceCount);
  const botCount = format(stats.botCount);
  const profiles = stats.profiles?.slice(0, 5).map((profile) =>
    `[${profile.displayName}](${profile.profileUrl})`,
  ).join(' • ');
  const embed = new EmbedBuilder()
    .setColor(KINGDOM_COLOR)
    .setTitle(`📊 ${stats.name} — Live statistics`)
    .setThumbnail(stats.iconUrl ?? interaction.client.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Total Members', value: memberCount, inline: true },
      { name: 'Citizen', value: citizenCount, inline: true },
      { name: 'Online', value: online, inline: true },
      { name: 'In Voice', value: inVoiceCount, inline: true },
      { name: 'Bots', value: botCount, inline: true },
      { name: 'Updated', value: `<t:${Math.floor(new Date(stats.updatedAt).getTime() / 1000)}:R>`, inline: true },
    );
  if (profiles) embed.addFields({ name: 'Featured public profiles', value: profiles });
  embed.setFooter({ text: 'Online and voice totals come from Leone\'s live Discord snapshot.' });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

module.exports = { data, execute, fallbackStats, help };
