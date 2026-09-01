const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildServerStatsFromGatewayGuild,
  createServerStatsService,
  fallbackAvatarUrl,
  profileFromUser,
} = require('../src/features/kingdom/server-stats/service');
const command = require('../src/features/kingdom/server-stats/command');

test('server stats service caches Discord counts and selected public profiles', async () => {
  let guildCalls = 0;
  let userCalls = 0;
  const users = {
    '1': { id: '1', username: 'owner', global_name: 'Leonore', avatar: null },
    '2': { id: '2', username: 'leannexyz', global_name: 'Leanne', avatar: 'hash' },
    '3': { id: '3', username: 'Leone', avatar: null },
  };
  const restClient = {
    getGuild: async () => {
      guildCalls += 1;
      return { id: 'guild', name: 'Kingdom', owner_id: '1', approximate_member_count: 42, approximate_presence_count: 7, icon: null };
    },
    getBotUser: async () => users['3'],
    getUser: async (id) => { userCalls += 1; return users[id]; },
  };
  let now = 1000;
  const service = createServerStatsService({ restClient, config: { STATS_CACHE_TTL_SECONDS: 30, STATS_FEATURED_USER_IDS: '2' }, now: () => now });
  const first = await service.get('guild');
  const second = await service.get('guild');
  assert.equal(first.memberCount, 42);
  assert.equal(first.onlineCount, 7);
  assert.deepEqual(first.profiles.map((profile) => profile.displayName), ['Leonore', 'Leanne', 'Leone']);
  assert.equal(first.profiles[1].profileUrl, 'https://discord.com/users/2');
  assert.equal(guildCalls, 1);
  assert.equal(userCalls, 4);
  assert.equal(second.updatedAt, first.updatedAt);
  now += 31_000;
  await service.get('guild');
  assert.equal(guildCalls, 2);
});

test('server stats service tolerates unavailable featured users and missing presence count', async () => {
  const service = createServerStatsService({
    restClient: {
      getGuild: async () => ({ id: 'guild', name: 'Kingdom', owner_id: '1', member_count: 10 }),
      getBotUser: async () => ({ id: '3', username: 'Leone', avatar: null }),
      getUser: async (id) => id === '1' ? ({ id: '1', username: 'owner', avatar: null }) : Promise.reject(new Error('not found')),
    },
  });
  const result = await service.get('guild');
  assert.equal(result.memberCount, 10);
  assert.equal(result.onlineCount, null);
  assert.equal(result.profiles.length, 1);
});

test('server stats service counts roles and includes public Admin and Moderator profiles', async () => {
  const users = {
    '1': { id: '1', username: 'owner', global_name: 'Owner', avatar: null },
    '2': { id: '2', username: 'admin', global_name: 'Admin One', avatar: null },
    '3': { id: '3', username: 'moderator', global_name: 'Moderator One', avatar: null },
    '4': { id: '4', username: 'bot', global_name: 'Leone', avatar: null, bot: true },
  };
  const members = [
    { user: users['1'], roles: ['citizen'] },
    { user: users['2'], roles: ['citizen', 'admin'] },
    { user: users['3'], roles: ['moderator'] },
    { user: users['4'], roles: ['citizen'] },
  ];
  const service = createServerStatsService({
    restClient: {
      getGuild: async () => ({ id: 'guild', name: 'Kingdom', owner_id: '1', member_count: 4, approximate_presence_count: 2 }),
      getBotUser: async () => users['4'],
      getUser: async (id) => users[id],
      getGuildRoles: async () => [
        { id: 'citizen', name: 'Citizen' },
        { id: 'admin', name: 'Admin' },
        { id: 'moderator', name: 'Moderator' },
      ],
      getGuildMembers: async () => members,
    },
  });

  const result = await service.get('guild');
  assert.equal(result.citizenCount, 3);
  assert.equal(result.botCount, 1);
  assert.equal(result.inVoiceCount, null);
  assert.deepEqual(result.profiles.map((profile) => [profile.displayName, profile.role ?? null]), [
    ['Owner', null],
    ['Leone', null],
    ['Admin One', 'Admin'],
    ['Moderator One', 'Moderator'],
  ]);
});

test('gateway server stats snapshot counts presences, voice states, bots, and staff roles', () => {
  const citizenRole = { id: 'citizen', name: 'Citizen' };
  const adminRole = { id: 'admin', name: 'Admin' };
  const moderatorRole = { id: 'moderator', name: 'Moderator' };
  const owner = { id: '1', username: 'owner', global_name: 'Owner', avatar: null, bot: false };
  const admin = { id: '2', username: 'admin', global_name: 'Admin One', avatar: null, bot: false };
  const moderator = { id: '3', username: 'moderator', global_name: 'Moderator One', avatar: null, bot: false };
  const bot = { id: '4', username: 'bot', global_name: 'Leone', avatar: null, bot: true };
  const members = [
    { user: owner, roles: { cache: new Map([[citizenRole.id, citizenRole]]) } },
    { user: admin, roles: { cache: new Map([[citizenRole.id, citizenRole], [adminRole.id, adminRole]]) } },
    { user: moderator, roles: { cache: new Map([[moderatorRole.id, moderatorRole]]) } },
    { user: bot, roles: { cache: new Map() } },
  ];
  const result = buildServerStatsFromGatewayGuild({
    guild: {
      id: 'guild',
      name: 'Kingdom',
      ownerId: owner.id,
      memberCount: members.length,
      members: { cache: new Map(members.map((member) => [member.user.id, member])) },
      roles: { cache: new Map([['citizen', citizenRole], ['admin', adminRole], ['moderator', moderatorRole]]) },
      presences: { cache: new Map([['1', { status: 'online' }], ['2', { status: 'idle' }]]) },
      voiceStates: { cache: new Map([['2', { channelId: 'voice-1' }], ['3', { channelId: 'voice-1' }]]) },
      iconURL: () => 'https://cdn.discordapp.com/icons/guild/icon.png?size=256',
    },
    botUser: bot,
    now: () => 1_000,
  });

  assert.equal(result.citizenCount, 2);
  assert.equal(result.onlineCount, 2);
  assert.equal(result.inVoiceCount, 2);
  assert.equal(result.botCount, 1);
  assert.deepEqual(result.profiles.map((profile) => [profile.displayName, profile.role ?? null]), [
    ['Owner', null],
    ['Leone', null],
    ['Admin One', 'Admin'],
    ['Moderator One', 'Moderator'],
  ]);
});

test('server stats service prefers a fresh Gateway snapshot for voice totals', async () => {
  const service = createServerStatsService({
    restClient: {
      getGuild: async () => { throw new Error('REST fallback should not run for a fresh snapshot'); },
      getBotUser: async () => { throw new Error('REST fallback should not run for a fresh snapshot'); },
    },
    snapshotRepository: {
      get: async () => ({
        guildId: 'guild',
        name: 'Kingdom',
        memberCount: 42,
        citizenCount: 30,
        onlineCount: 7,
        inVoiceCount: 3,
        botCount: 2,
        iconUrl: null,
        profiles: [],
        updatedAt: new Date(1_000).toISOString(),
      }),
    },
    config: { STATS_GATEWAY_SNAPSHOT_MAX_AGE_SECONDS: 180 },
    now: () => 2_000,
  });

  const result = await service.get('guild');
  assert.equal(result.inVoiceCount, 3);
  assert.equal(result.botCount, 2);
  assert.equal(result.onlineCount, 7);
});

test('server stats command uses live service data and avoids mentions', async () => {
  let reply;
  const interaction = {
    guildId: 'guild',
    inGuild: () => true,
    deferReply: async () => {},
    editReply: async (payload) => { reply = payload; },
    client: { user: { displayAvatarURL: () => 'https://example.com/leone.png' } },
  };
  await command.execute(interaction, {
    serverStats: { get: async () => ({ name: 'Kingdom', memberCount: 10, citizenCount: 8, onlineCount: 3, inVoiceCount: 2, botCount: 1, updatedAt: new Date().toISOString(), iconUrl: null, profiles: [] }) },
  });
  const embed = reply.embeds[0].toJSON();
  assert.match(embed.title, /Kingdom/);
  assert.deepEqual(embed.fields.slice(0, 5).map((field) => [field.name, field.value]), [
    ['Total Members', '10'],
    ['Citizen', '8'],
    ['Online', '3'],
    ['In Voice', '2'],
    ['Bots', '1'],
  ]);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('profile URLs and fallback avatars use Discord public URLs', () => {
  assert.match(fallbackAvatarUrl({ id: '1', avatar: null }), /cdn\.discordapp\.com\/embed\/avatars/);
  assert.deepEqual(profileFromUser({ id: '2', username: 'leannexyz', global_name: 'Leanne', avatar: 'abc' }), {
    id: '2',
    username: 'leannexyz',
    displayName: 'Leanne',
    avatarUrl: 'https://cdn.discordapp.com/avatars/2/abc.png?size=128',
    profileUrl: 'https://discord.com/users/2',
  });
});
