const { PermissionFlagsBits } = require('discord.js');

/**
 * Find the first role whose name matches one of the supplied names.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string[]} names
 */
function findRoleByName(guild, names) {
  const normalizedNames = new Set(
    names.map((name) => name.toLowerCase()),
  );

  return guild.roles.cache.find((role) =>
    normalizedNames.has(role.name.toLowerCase()),
  );
}

/**
 * Format a role without notifying its members.
 *
 * @param {import('discord.js').Role | undefined} role
 * @param {string} fallbackName
 */
function formatRole(role, fallbackName) {
  return role
    ? `<@&${role.id}>`
    : `**${fallbackName}** *(role not configured)*`;
}

/**
 * Check whether an interaction member can view a channel.
 *
 * @param {import('discord.js').GuildBasedChannel} channel
 * @param {import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember} member
 */
function canViewChannel(channel, member) {
  return Boolean(
    channel
      .permissionsFor(member)
      ?.has(PermissionFlagsBits.ViewChannel),
  );
}

module.exports = {
  canViewChannel,
  findRoleByName,
  formatRole,
};
