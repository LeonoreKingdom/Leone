const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
    serverStats: { get: async () => ({ name: 'Kingdom', memberCount: 10, onlineCount: 3, updatedAt: new Date().toISOString(), iconUrl: null, profiles: [] }) },
  });
  assert.match(reply.embeds[0].toJSON().title, /Kingdom/);
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
