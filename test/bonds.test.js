const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MessageFlags } = require('discord.js');

const {
  BondError,
  BondService,
  REQUEST_RETENTION_MS,
} = require('../src/features/relationships/bond-service');
const {
  JsonBondStore,
  MemoryBondStore,
} = require('../src/features/relationships/bond-store');
const {
  createBondsCommand,
} = require('../src/features/relationships/bonds.command');

function createService(options = {}) {
  let id = 0;

  return new BondService({
    store: options.store ?? new MemoryBondStore(),
    now: options.now ?? (() => 1_000_000),
    createId:
      options.createId ?? (() => `relationship-${++id}`),
  });
}

async function accept(
  service,
  {
    guildId = 'guild',
    requesterId,
    targetId,
    requestedType,
  },
) {
  const request = await service.createRequest({
    guildId,
    requesterId,
    targetId,
    requestedType,
  });

  return service.acceptRequest({
    guildId,
    userId: targetId,
    requestId: request.id,
  });
}

test('bonds require reciprocal consent and reject duplicates', async () => {
  const service = createService();
  const request = await service.createRequest({
    guildId: 'guild',
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'partner',
  });
  const beforeAcceptance = await service.exportUserData({
    guildId: 'guild',
    userId: 'alice',
  });

  assert.equal(beforeAcceptance.edges.length, 0);
  assert.equal(beforeAcceptance.requests.length, 1);

  await assert.rejects(
    service.acceptRequest({
      guildId: 'guild',
      userId: 'mallory',
      requestId: request.id,
    }),
    (error) =>
      error instanceof BondError &&
      error.code === 'REQUEST_NOT_FOUND',
  );

  await service.acceptRequest({
    guildId: 'guild',
    userId: 'bob',
    requestId: request.id,
  });
  const afterAcceptance = await service.exportUserData({
    guildId: 'guild',
    userId: 'alice',
  });

  assert.equal(afterAcceptance.requests.length, 0);
  assert.equal(afterAcceptance.edges.length, 1);

  await assert.rejects(
    service.createRequest({
      guildId: 'guild',
      requesterId: 'bob',
      targetId: 'alice',
      requestedType: 'partner',
    }),
    (error) =>
      error instanceof BondError &&
      error.code === 'DUPLICATE_EDGE',
  );
});

test('parent and mentor graphs reject cycles', async () => {
  const service = createService();

  await accept(service, {
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'parent',
  });
  await accept(service, {
    requesterId: 'bob',
    targetId: 'charlie',
    requestedType: 'parent',
  });

  await assert.rejects(
    service.createRequest({
      guildId: 'guild',
      requesterId: 'charlie',
      targetId: 'alice',
      requestedType: 'parent',
    }),
    (error) =>
      error instanceof BondError && error.code === 'CYCLE',
  );

  await accept(service, {
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'mentor',
  });
  await accept(service, {
    requesterId: 'bob',
    targetId: 'charlie',
    requestedType: 'mentor',
  });

  await assert.rejects(
    service.createRequest({
      guildId: 'guild',
      requesterId: 'charlie',
      targetId: 'alice',
      requestedType: 'mentor',
    }),
    (error) =>
      error instanceof BondError && error.code === 'CYCLE',
  );
});

test('privacy requires every participant to permit third-party viewing', async () => {
  const service = createService();

  await accept(service, {
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'best-friend',
  });
  await service.setPrivacy({
    guildId: 'guild',
    userId: 'alice',
    visibility: 'public',
  });

  const hiddenPartner = await service.getTree({
    guildId: 'guild',
    viewerId: 'charlie',
    memberId: 'alice',
  });

  assert.equal(hiddenPartner.relationships.length, 0);

  await service.setPrivacy({
    guildId: 'guild',
    userId: 'bob',
    visibility: 'public',
  });

  const visiblePartner = await service.getTree({
    guildId: 'guild',
    viewerId: 'charlie',
    memberId: 'alice',
  });

  assert.equal(visiblePartner.relationships.length, 1);
  assert.equal(
    visiblePartner.relationships[0].otherUserId,
    'bob',
  );

  await service.setPrivacy({
    guildId: 'guild',
    userId: 'alice',
    visibility: 'private',
  });

  await assert.rejects(
    service.getTree({
      guildId: 'guild',
      viewerId: 'charlie',
      memberId: 'alice',
    }),
    (error) =>
      error instanceof BondError &&
      error.code === 'PRIVATE_TREE',
  );
});

test('blocking removes pending requests and bonds in both directions', async () => {
  const service = createService();

  await accept(service, {
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'sibling',
  });
  await service.createRequest({
    guildId: 'guild',
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'mentor',
  });

  const result = await service.block({
    guildId: 'guild',
    userId: 'bob',
    targetId: 'alice',
  });

  assert.equal(result.removedEdges, 1);
  assert.equal(result.removedRequests, 1);

  await assert.rejects(
    service.createRequest({
      guildId: 'guild',
      requesterId: 'alice',
      targetId: 'bob',
      requestedType: 'partner',
    }),
    (error) =>
      error instanceof BondError && error.code === 'BLOCKED',
  );

  assert.equal(
    await service.unblock({
      guildId: 'guild',
      userId: 'bob',
      targetId: 'alice',
    }),
    true,
  );
});

test('requests expire and deletion removes all server-scoped data', async () => {
  let now = 1_000_000;
  const service = createService({
    now: () => now,
  });

  await service.createRequest({
    guildId: 'guild',
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'found-family',
  });

  now += REQUEST_RETENTION_MS + 1;

  const expired = await service.listRequests({
    guildId: 'guild',
    userId: 'bob',
  });

  assert.equal(expired.incoming.length, 0);
  assert.equal(
    (
      await service.exportUserData({
        guildId: 'guild',
        userId: 'alice',
      })
    ).requests.length,
    0,
  );

  await accept(service, {
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'partner',
  });
  await service.setPrivacy({
    guildId: 'guild',
    userId: 'alice',
    visibility: 'public',
  });

  const beforeDeletion = await service.exportUserData({
    guildId: 'guild',
    userId: 'alice',
  });
  assert.equal(beforeDeletion.profile.visibility, 'public');
  assert.equal(beforeDeletion.edges.length, 1);

  const deletion = await service.eraseUserData({
    guildId: 'guild',
    userId: 'alice',
  });

  assert.equal(deletion.removedEdges, 1);

  const afterDeletion = await service.exportUserData({
    guildId: 'guild',
    userId: 'alice',
  });
  assert.equal(afterDeletion.profile.visibility, 'private');
  assert.equal(afterDeletion.edges.length, 0);
  assert.equal(afterDeletion.requests.length, 0);
});

test('unlink requires a type when two members share multiple bonds', async () => {
  const service = createService();

  await accept(service, {
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'partner',
  });
  await accept(service, {
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'best-friend',
  });

  await assert.rejects(
    service.unlink({
      guildId: 'guild',
      userId: 'alice',
      targetId: 'bob',
    }),
    (error) =>
      error instanceof BondError &&
      error.code === 'TYPE_REQUIRED',
  );

  await service.unlink({
    guildId: 'guild',
    userId: 'alice',
    targetId: 'bob',
    requestedType: 'partner',
  });

  const remaining = await service.exportUserData({
    guildId: 'guild',
    userId: 'alice',
  });

  assert.equal(remaining.edges.length, 1);
  assert.equal(remaining.edges[0].type, 'best-friend');
});

test('JSON storage persists requests across service instances', async (t) => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'leone-bonds-'),
  );
  const filePath = path.join(
    temporaryDirectory,
    'bonds.json',
  );

  t.after(async () => {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  });

  const firstService = createService({
    store: new JsonBondStore({ filePath }),
  });

  await firstService.createRequest({
    guildId: 'guild',
    requesterId: 'alice',
    targetId: 'bob',
    requestedType: 'partner',
  });

  const secondService = createService({
    store: new JsonBondStore({ filePath }),
  });
  const persisted = await secondService.listRequests({
    guildId: 'guild',
    userId: 'bob',
  });

  assert.equal(persisted.incoming.length, 1);
  assert.equal(
    persisted.incoming[0].requesterId,
    'alice',
  );
});

test('bonds command performs a private request and acceptance flow', async () => {
  const service = createService();
  const command = createBondsCommand(service);
  let directMessage;
  let requestResponse;
  let requestDeferred;
  const target = {
    id: 'bob',
    bot: false,
    send: async (payload) => {
      directMessage = payload;
    },
  };

  await command.execute({
    guildId: 'guild',
    guild: { name: "Leonore's Kingdom" },
    user: { id: 'alice' },
    inGuild: () => true,
    options: {
      getSubcommand: () => 'request',
      getUser: () => target,
      getString: (name) =>
        name === 'type' ? 'partner' : null,
    },
    deferReply: async (payload) => {
      requestDeferred = payload;
    },
    editReply: async (payload) => {
      requestResponse = payload;
    },
  });

  assert.equal(
    requestDeferred.flags,
    MessageFlags.Ephemeral,
  );
  assert.match(directMessage.content, /No bond exists/);
  assert.match(requestResponse.content, /pending consent/);

  const pending = await service.listRequests({
    guildId: 'guild',
    userId: 'bob',
  });
  const requestId = pending.incoming[0].id;
  let acceptResponse;

  await command.execute({
    guildId: 'guild',
    guild: { name: "Leonore's Kingdom" },
    user: { id: 'bob' },
    inGuild: () => true,
    options: {
      getSubcommand: () => 'accept',
      getString: () => requestId,
    },
    deferReply: async () => {},
    editReply: async (payload) => {
      acceptResponse = payload;
    },
  });

  assert.match(acceptResponse.content, /Bond accepted/);

  const exported = await service.exportUserData({
    guildId: 'guild',
    userId: 'alice',
  });
  assert.equal(exported.edges.length, 1);
});
