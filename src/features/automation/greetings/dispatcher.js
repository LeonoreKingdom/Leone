const { createHash } = require('node:crypto');

const { createBmkgClient } = require('../morning/bmkg-client');
const { buildGreetingMessage } = require('./greeting-message');

function deliveryNonce(scheduleId, scheduledFor) {
  return createHash('sha256')
    .update(`${scheduleId}:${new Date(scheduledFor).toISOString()}`)
    .digest('hex')
    .slice(0, 24);
}

async function dispatchDueGreetings({
  repository,
  restClient,
  auditRepository = null,
  bmkgClient = createBmkgClient(),
  enabled = true,
  limit = 10,
}) {
  if (!enabled) return { disabled: true, claimed: 0, sent: 0, failed: 0 };

  const runs = await repository.claimDueRuns(limit);
  const summary = { disabled: false, claimed: runs.length, sent: 0, failed: 0 };

  for (const run of runs) {
    let weather = null;
    let weatherStatus = 'not_configured';
    if (run.adm4) {
      try {
        weather = await bmkgClient.getForecast(run.adm4);
        weatherStatus = 'available';
      } catch {
        weatherStatus = 'unavailable';
      }
    }

    try {
      const message = await restClient.sendChannelMessage(run.channel_id, {
        content: buildGreetingMessage({
          occasion: run.occasion,
          roleMention: `<@&${run.role_id}>`,
          weather,
          locationLabel: run.location_label,
          date: new Date(run.scheduled_for),
        }),
        allowed_mentions: {
          parse: [],
          roles: [run.role_id],
          users: [],
          replied_user: false,
        },
        nonce: deliveryNonce(run.id, run.scheduled_for),
        enforce_nonce: true,
      });
      await repository.completeRun({
        runId: run.run_id,
        status: 'sent',
        messageId: message.id,
        providerStatus: { bmkg: weatherStatus },
      });
      await auditRepository?.record({
        guildId: run.guild_id,
        action: 'greeting.schedule_sent',
        targetCategory: 'schedule',
        targetId: run.id,
        metadata: { runId: run.run_id, messageId: message.id },
      });
      summary.sent += 1;
    } catch (error) {
      await repository.completeRun({
        runId: run.run_id,
        status: 'failed',
        providerStatus: { bmkg: weatherStatus },
        errorCode: error.code ? String(error.code) : 'DELIVERY_FAILED',
      });
      await auditRepository?.record({
        guildId: run.guild_id,
        action: 'greeting.schedule_failed',
        targetCategory: 'schedule',
        targetId: run.id,
        result: 'failure',
        reason: error.code ? String(error.code) : 'DELIVERY_FAILED',
        metadata: { runId: run.run_id },
      });
      summary.failed += 1;
    }
  }

  return summary;
}

module.exports = { deliveryNonce, dispatchDueGreetings };
