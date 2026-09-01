const { LEANNE_USER_ID } = require('../../../shared/constants');

const DEFAULT_CITIZEN_ROLE_NAME = 'Citizen';
const DEFAULT_ADMIN_ROLE_NAME = 'Admin';
const DEFAULT_MODERATOR_ROLE_NAME = 'Moderator';
const DEFAULT_ROLE_PROFILE_LIMIT = 2;
const MAX_PROFILES = 12;

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

function profileFromUser(user, role = null) {
  const profile = {
    id: user.id,
    username: user.username ?? null,
    displayName: user.global_name ?? user.username ?? user.id,
    avatarUrl: fallbackAvatarUrl(user),
    profileUrl: `https://discord.com/users/${user.id}`,
  };
  if (role) profile.role = role;
  return profile;
}

function configuredFeaturedIds(config = {}) {
  return String(config.STATS_FEATURED_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));
}

function configuredRoleName(config, key, fallback) {
  const value = String(config[key] ?? '').trim();
  return value || fallback;
}

function configuredRoleProfileLimit(config = {}) {
  const value = Number(config.STATS_ROLE_PROFILE_LIMIT ?? DEFAULT_ROLE_PROFILE_LIMIT);
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 5) : DEFAULT_ROLE_PROFILE_LIMIT;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return [...collection.values()];
  return Array.isArray(collection) ? collection : [];
}

function hasRole(member, roleId) {
  if (!roleId || !member?.roles) return false;
  if (typeof member.roles.includes === 'function') return member.roles.includes(roleId);
  if (typeof member.roles.cache?.has === 'function') return member.roles.cache.has(roleId);
  if (typeof member.roles.has === 'function') return member.roles.has(roleId);
  return false;
}

function roleByName(roles, name) {
  const expected = name.toLocaleLowerCase();
  return roles.find((role) => String(role?.name ?? '').trim().toLocaleLowerCase() === expected) ?? null;
}

function mergeProfiles(profiles) {
  const merged = new Map();
  for (const profile of profiles) {
    if (!profile?.id || (merged.has(profile.id) && !profile.role)) continue;
    const previous = merged.get(profile.id);
    merged.set(profile.id, previous ? { ...previous, role: previous.role ?? profile.role } : profile);
  }
  return [...merged.values()].slice(0, MAX_PROFILES);
}

function profileCandidatesFromMembers(members, roles, config = {}) {
  const roleDefinitions = [
    { label: 'Admin', name: configuredRoleName(config, 'STATS_ADMIN_ROLE_NAME', DEFAULT_ADMIN_ROLE_NAME) },
    { label: 'Moderator', name: configuredRoleName(config, 'STATS_MODERATOR_ROLE_NAME', DEFAULT_MODERATOR_ROLE_NAME) },
  ];
  const profiles = [];
  const roleLimit = configuredRoleProfileLimit(config);

  for (const definition of roleDefinitions) {
    const role = roleByName(roles, definition.name);
    if (!role) continue;
    members
      .filter((member) => member?.user && !member.user.bot && hasRole(member, role.id))
      .slice(0, roleLimit)
      .forEach((member) => profiles.push(profileFromUser(member.user, definition.label)));
  }

  return profiles;
}

function numericCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function roleCount(members, role, available) {
  if (!available || !role) return null;
  return members.filter((member) => hasRole(member, role.id)).length;
}

function buildServerStatsFromGatewayGuild({ guild, botUser = null, config = {}, now = () => Date.now(), membersComplete = true } = {}) {
  const members = collectionValues(guild?.members?.cache ?? guild?.members);
  const roles = collectionValues(guild?.roles?.cache ?? guild?.roles);
  const membersAvailable = Boolean(membersComplete && guild?.members && members.length >= 0);
  const citizenRole = roleByName(
    roles,
    configuredRoleName(config, 'STATS_CITIZEN_ROLE_NAME', DEFAULT_CITIZEN_ROLE_NAME),
  );
  const fixedIds = [
    guild?.ownerId,
    LEANNE_USER_ID,
    ...configuredFeaturedIds(config),
    botUser?.id,
  ].filter((id) => /^\d+$/.test(String(id ?? '')));
  const membersById = new Map(members.map((member) => [member.user?.id, member]));
  const fixedProfiles = [...new Set(fixedIds)]
    .map((id) => membersById.get(id)?.user)
    .filter(Boolean)
    .map((user) => profileFromUser(user));
  const presenceCache = guild?.presences?.cache;
  const voiceStateCache = guild?.voiceStates?.cache;
  const onlineCount = presenceCache
    ? collectionValues(presenceCache).filter((presence) => presence.status && presence.status !== 'offline').length
    : null;
  const inVoiceCount = voiceStateCache
    ? collectionValues(voiceStateCache).filter((state) => state.channelId).length
    : null;

  return {
    guildId: guild?.id,
    name: guild?.name,
    memberCount: numericCount(guild?.memberCount ?? members.length),
    citizenCount: roleCount(members, citizenRole, membersAvailable),
    onlineCount,
    inVoiceCount,
    botCount: membersAvailable ? members.filter((member) => member.user?.bot).length : null,
    iconUrl: guild?.iconURL?.({ size: 256 }) ?? null,
    profiles: mergeProfiles([
      ...fixedProfiles,
      ...profileCandidatesFromMembers(members, roles, config),
    ]),
    updatedAt: new Date(now()).toISOString(),
  };
}

async function loadGuildMembers(restClient, guildId, config = {}) {
  if (typeof restClient.getGuildMembers !== 'function') return { available: false, members: [] };

  const limit = 1_000;
  const maxPages = Math.min(Math.max(Number(config.STATS_MAX_MEMBER_PAGES ?? 100), 1), 1_000);
  const members = [];
  let after = null;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    let page;
    try {
      page = await restClient.getGuildMembers(guildId, { limit, after });
    } catch {
      return { available: false, members: [] };
    }
    if (!Array.isArray(page)) return { available: false, members: [] };
    members.push(...page);
    if (page.length < limit) return { available: true, members };
    const nextAfter = page.at(-1)?.user?.id;
    if (!nextAfter || nextAfter === after) return { available: false, members: [] };
    after = nextAfter;
  }

  return { available: false, members: [] };
}

function buildRestProfiles({ users, members, roles, config }) {
  const fixedProfiles = users.filter(Boolean).map((user) => profileFromUser(user));
  const roleProfiles = profileCandidatesFromMembers(members, roles, config);
  return mergeProfiles([...fixedProfiles, ...roleProfiles]);
}

function createServerStatsService({ restClient, config = {}, now = () => Date.now(), snapshotRepository = null } = {}) {
  const cache = new Map();
  const pending = new Map();
  const ttlMs = Math.min(Math.max(Number(config.STATS_CACHE_TTL_SECONDS ?? 30) * 1000, 5_000), 300_000);
  const snapshotMaxAgeMs = Math.min(Math.max(Number(config.STATS_GATEWAY_SNAPSHOT_MAX_AGE_SECONDS ?? 180) * 1000, 30_000), 900_000);

  async function readFreshSnapshot(guildId) {
    if (!snapshotRepository || typeof snapshotRepository.get !== 'function') return null;
    try {
      const snapshot = await snapshotRepository.get(guildId);
      if (!snapshot || Number.isNaN(Date.parse(snapshot.updatedAt))) return null;
      return now() - Date.parse(snapshot.updatedAt) <= snapshotMaxAgeMs ? snapshot : null;
    } catch {
      return null;
    }
  }

  async function load(guildId) {
    const gatewaySnapshot = await readFreshSnapshot(guildId);
    if (gatewaySnapshot) return gatewaySnapshot;

    const [guild, botUser] = await Promise.all([
      restClient.getGuild(guildId),
      restClient.getBotUser(),
    ]);
    const [roles, memberResult] = await Promise.all([
      typeof restClient.getGuildRoles === 'function'
        ? restClient.getGuildRoles(guildId).catch(() => [])
        : Promise.resolve([]),
      loadGuildMembers(restClient, guildId, config),
    ]);
    const members = memberResult.members;
    const citizenRole = roleByName(
      roles,
      configuredRoleName(config, 'STATS_CITIZEN_ROLE_NAME', DEFAULT_CITIZEN_ROLE_NAME),
    );
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
    const memberCount = numericCount(guild.approximate_member_count ?? guild.member_count);
    const onlineValue = guild.approximate_presence_count ?? guild.presence_count;
    return {
      guildId: guild.id ?? guildId,
      name: guild.name,
      memberCount,
      citizenCount: roleCount(members, citizenRole, memberResult.available),
      onlineCount: onlineValue == null ? null : numericCount(onlineValue),
      inVoiceCount: guild.in_voice_count == null ? null : numericCount(guild.in_voice_count),
      botCount: memberResult.available ? members.filter((member) => member.user?.bot).length : null,
      iconUrl: guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id ?? guildId}/${guild.icon}.png?size=256`
        : null,
      profiles: buildRestProfiles({ users, members: memberResult.available ? members : [], roles, config }),
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
  buildServerStatsFromGatewayGuild,
  createServerStatsService,
  fallbackAvatarUrl,
  profileFromUser,
};
