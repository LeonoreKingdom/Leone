const { LEANNE_USER_ID } = require('../../../shared/constants');

function fallbackAvatarUrl(user, size = 128) {
  if (user?.avatar) {
    const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
  }

  const index = user?.discriminator && user.discriminator !== '0'
    ? Number(user.discriminator) % 5
    : Number((BigInt(user?.id ?? 0) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function profileFromUser(user) {
  return {
    id: user.id,
    username: user.username ?? null,
    displayName: user.global_name ?? user.username ?? user.id,
    avatarUrl: fallbackAvatarUrl(user),
    profileUrl: `https://discord.com/users/${user.id}`,
  };
}

function configuredFeaturedIds(config = {}) {
  return String(config.STATS_FEATURED_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));
}

function createServerStatsService({ restClient, config = {}, now = () => Date.now() } = {}) {
  const cache = new Map();
  const pending = new Map();
  const ttlMs = Math.min(Math.max(Number(config.STATS_CACHE_TTL_SECONDS ?? 30) * 1000, 5_000), 300_000);

  async function load(guildId) {
    const [guild, botUser] = await Promise.all([
      restClient.getGuild(guildId),
      restClient.getBotUser(),
    ]);
    const ids = [...new Set([
      guild.owner_id,
      LEANNE_USER_ID,
      ...configuredFeaturedIds(config),
      botUser?.id,
    ].filter((id) => /^\d+$/.test(String(id ?? ''))))].slice(0, 8);
    const users = await Promise.all(ids.map(async (id) => {
      try {
        return await restClient.getUser(id);
      } catch {
        return null;
      }
    }));
    const profiles = users.filter(Boolean).map(profileFromUser);
    const memberCount = Number(guild.approximate_member_count ?? guild.member_count);
    const onlineValue = guild.approximate_presence_count ?? guild.presence_count;
    return {
      guildId: guild.id ?? guildId,
      name: guild.name,
      memberCount: Number.isFinite(memberCount) ? memberCount : null,
      onlineCount: onlineValue == null ? null : Number(onlineValue),
      iconUrl: guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id ?? guildId}/${guild.icon}.png?size=256`
        : null,
      profiles,
      updatedAt: new Date(now()).toISOString(),
    };
  }

  async function get(guildId, options = {}) {
    if (!guildId) throw new Error('A guild ID is required to load server statistics.');
    const cached = cache.get(guildId);
    if (!options.force && cached && cached.expiresAt > now()) return cached.value;
    if (pending.has(guildId)) return pending.get(guildId);
    const request = load(guildId)
      .then((value) => {
        cache.set(guildId, { value, expiresAt: now() + ttlMs });
        return value;
      })
      .finally(() => pending.delete(guildId));
    pending.set(guildId, request);
    return request;
  }

  function clear(guildId) {
    if (guildId) cache.delete(guildId);
    else cache.clear();
  }

  return { clear, get };
}

module.exports = {
  createServerStatsService,
  fallbackAvatarUrl,
  profileFromUser,
};
