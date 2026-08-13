const assert = require('node:assert/strict');
const test = require('node:test');

const { PermissionFlagsBits } = require('discord.js');
const {
  previewRoleOperation,
  createRole,
} = require('../src/features/admin/server-admin-service');
const { validateModerationInput } = require('../src/features/admin/moderation-service');

function fakeRest() {
  const guildId = '100000000000000001';
  const botId = '100000000000000002';
  const roleId = '100000000000000003';
  const memberId = '100000000000000004';
  const permissions = String(PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageChannels);
  const bundle = {
    guild: { id: guildId, owner_id: '100000000000000005' },
    roles: [
      { id: guildId, name: '@everyone', position: 0, permissions: '0' },
      { id: roleId, name: 'Citizen', position: 1, permissions: '0', managed: false },
      { id: '100000000000000006', name: 'Leone', position: 10, permissions },
    ],
    channels: [],
  };
  return {
    bundle,
    botId,
    roleId,
    memberId,
    getGuildBundle: async () => bundle,
    getBotUser: async () => ({ id: botId, username: 'Leone' }),
    getGuildMember: async (_guildId, userId) => userId === botId
      ? { user: { id: botId, username: 'Leone' }, roles: ['100000000000000006'] }
      : { user: { id: memberId, username: 'tester', global_name: 'Tester' }, roles: [] },
    createRole: async () => ({ id: '100000000000000007', name: 'New role' }),
  };
}

test('role operation preview excludes members who already have the requested role', async () => {
  const rest = fakeRest();
  const preview = await previewRoleOperation({
    guildId: rest.bundle.guild.id,
    restClient: rest,
    action: 'assign',
    roleId: rest.roleId,
    userIds: [rest.memberId],
  });
  assert.equal(preview.affectedCount, 1);
  assert.equal(preview.confirmationPhrase, 'ASSIGN 1 MEMBERS');
  assert.equal(preview.members[0].label, 'Tester');
});

test('role creation forces zero permissions', async () => {
  const rest = fakeRest();
  let payload;
  rest.createRole = async (_guildId, value) => { payload = value; return { id: '100000000000000007' }; };
  await createRole({ guildId: rest.bundle.guild.id, restClient: rest, payload: { name: 'Helper' }, reason: 'test' });
  assert.equal(payload.permissions, '0');
});

test('moderation validation enforces Discord limits', () => {
  assert.throws(() => validateModerationInput({ action: 'timeout', durationSeconds: 2419201 }), /28 days/);
  assert.throws(() => validateModerationInput({ action: 'purge', channelId: '1', messageCount: 101 }), /between 1 and 100/);
  assert.doesNotThrow(() => validateModerationInput({ action: 'ban', deleteMessageSeconds: 604800 }));
});
