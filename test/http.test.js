const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const test = require('node:test');
const request = require('supertest');

const { createApp } = require('../app');

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    publicKeyHex: Buffer.from(publicJwk.x, 'base64url').toString('hex'),
  };
}

function config(publicKey) {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PUBLIC_WEB_ORIGIN: 'http://localhost:3000',
    DISCORD_PUBLIC_KEY: publicKey,
    greetingsSchedulerEnabled: false,
    isProduction: false,
  };
}

function signature(privateKey, timestamp, body) {
  return sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey).toString('hex');
}

function snowflake(timestamp = Date.now() - 25) {
  const discordEpoch = 1420070400000n;
  return ((BigInt(timestamp) - discordEpoch) << 22n).toString();
}

async function sendSignedInteraction(app, privateKey, payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return request(app)
    .post('/api/discord/interactions')
    .set('content-type', 'application/json')
    .set('x-signature-timestamp', timestamp)
    .set('x-signature-ed25519', signature(privateKey, timestamp, body))
    .send(body);
}

test('health check is explicit when dependencies are not configured', async () => {
  const app = createApp({ config: config('0'.repeat(64)) });
  const response = await request(app).get('/healthz');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'unhealthy' });
});

test('Discord interaction endpoint rejects unsigned requests', async () => {
  const app = createApp({ config: config('0'.repeat(64)) });
  const response = await request(app)
    .post('/api/discord/interactions')
    .set('content-type', 'application/json')
    .send('{"type":1}');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'INVALID_SIGNATURE');
});

test('Discord interaction endpoint rejects a mismatched signature', async () => {
  const keys = fixture();
  const otherKeys = fixture();
  const body = '{"type":1}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const app = createApp({ config: config(keys.publicKeyHex) });
  const response = await request(app)
    .post('/api/discord/interactions')
    .set('content-type', 'application/json')
    .set('x-signature-timestamp', timestamp)
    .set('x-signature-ed25519', signature(otherKeys.privateKey, timestamp, body))
    .send(body);
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'INVALID_SIGNATURE');
});

test('Discord interaction endpoint verifies raw body and answers PING', async () => {
  const keys = fixture();
  const body = '{"type":1}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const app = createApp({ config: config(keys.publicKeyHex) });
  const response = await request(app)
    .post('/api/discord/interactions')
    .set('content-type', 'application/json')
    .set('x-signature-timestamp', timestamp)
    .set('x-signature-ed25519', signature(keys.privateKey, timestamp, body))
    .send(body);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { type: 1 });
});

test('slash ping responds immediately without hydrating the guild', async () => {
  const keys = fixture();
  let restCallCount = 0;
  const restClient = new Proxy({}, {
    get: () => async () => {
      restCallCount += 1;
      throw new Error('The ping fast path must not call Discord REST.');
    },
  });
  const app = createApp({
    config: config(keys.publicKeyHex),
    restClient,
  });

  const response = await sendSignedInteraction(
    app,
    keys.privateKey,
    {
      id: snowflake(),
      application_id: '1532088865035124946',
      type: 2,
      token: 'interaction-token',
      guild_id: '332544131693936642',
      channel_id: '123456789012345678',
      member: {
        permissions: '0',
        roles: [],
        user: { id: '123456789012345678', username: 'tester' },
      },
      data: { name: 'ping', type: 1 },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.type, 4);
  assert.match(response.body.data.content, /Leone is online/);
  assert.match(response.body.data.content, /HTTP interactions/);
  assert.equal(restCallCount, 0);
});

test('deferred commands register their complete work with waitUntil', async () => {
  const keys = fixture();
  let registeredTask;
  let editedReply;
  const guildId = '332544131693936642';
  const restClient = {
    getGuildBundle: async () => ({
      guild: {
        id: guildId,
        name: "Leonore's Kingdom",
        owner_id: '123456789012345678',
        approximate_member_count: 1,
      },
      channels: [],
      roles: [{ id: guildId, name: '@everyone', permissions: '0' }],
    }),
    getBotUser: async () => ({
      id: '1532088865035124946',
      username: 'Leone',
      avatar: null,
    }),
    editInteractionReply: async (...args) => {
      editedReply = args;
      return args[2];
    },
  };
  const app = createApp({
    config: config(keys.publicKeyHex),
    restClient,
    waitUntil: (task) => {
      registeredTask = task;
    },
  });

  const response = await sendSignedInteraction(
    app,
    keys.privateKey,
    {
      id: snowflake(),
      application_id: '1532088865035124946',
      app_permissions: '0',
      type: 2,
      token: 'interaction-token',
      guild_id: guildId,
      channel_id: '123456789012345678',
      locale: 'en-US',
      member: {
        permissions: '0',
        roles: [],
        user: { id: '123456789012345678', username: 'tester' },
      },
      data: { name: 'help', type: 1, options: [] },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.type, 5);
  assert.ok(registeredTask instanceof Promise);

  await registeredTask;

  assert.ok(editedReply);
  assert.equal(editedReply[0], '1532088865035124946');
  assert.equal(editedReply[1], 'interaction-token');
  assert.ok(editedReply[2].embeds.length >= 1);
});
