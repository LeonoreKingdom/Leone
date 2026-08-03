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
