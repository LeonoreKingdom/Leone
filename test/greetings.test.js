const assert = require('node:assert/strict');
const test = require('node:test');

const { deliveryNonce, dispatchDueGreetings } = require('../src/features/automation/greetings/dispatcher');

test('scheduled greeting delivery uses a stable enforced nonce', async () => {
  const run = {
    run_id: 'run-1', id: 'schedule-1', guild_id: '332544131693936642',
    scheduled_for: '2026-08-03T00:00:00.000Z', channel_id: '10', role_id: '20',
    occasion: 'morning', adm4: null, location_label: 'Jakarta',
  };
  const completed = [];
  let sentPayload;
  const repository = {
    claimDueRuns: async () => [run],
    completeRun: async (value) => completed.push(value),
  };
  const summary = await dispatchDueGreetings({
    repository,
    restClient: { sendChannelMessage: async (channelId, payload) => { sentPayload = { channelId, ...payload }; return { id: 'message-1' }; } },
    bmkgClient: { getForecast: async () => null },
  });
  assert.equal(summary.sent, 1);
  assert.equal(sentPayload.enforce_nonce, true);
  assert.deepEqual(sentPayload.allowed_mentions.roles, ['20']);
  assert.equal(sentPayload.nonce, deliveryNonce(run.id, run.scheduled_for));
  assert.equal(completed[0].status, 'sent');
});

test('disabled dispatcher never claims schedules', async () => {
  let claimed = false;
  const result = await dispatchDueGreetings({
    enabled: false,
    repository: { claimDueRuns: async () => { claimed = true; return []; } },
    restClient: {},
  });
  assert.equal(claimed, false);
  assert.equal(result.disabled, true);
});
