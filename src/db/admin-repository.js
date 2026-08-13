const { randomUUID } = require('node:crypto');

function json(value) {
  return JSON.stringify(value ?? {});
}

class AdminRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findOperationByRequest(guildId, clientRequestId) {
    const { rows } = await this.pool.query(
      `select * from admin_operations where guild_id = $1 and client_request_id = $2`,
      [guildId, clientRequestId],
    );
    return rows[0] ?? null;
  }

  async createOperation({
    guildId,
    actorUserId,
    operationType,
    targetId = null,
    clientRequestId = randomUUID(),
    confirmationPhrase = null,
    preview = {},
    payload = {},
    correlationId = randomUUID(),
  }) {
    const { rows } = await this.pool.query(
      `insert into admin_operations
        (guild_id, actor_user_id, operation_type, target_id, client_request_id,
         confirmation_phrase, preview, payload, correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
       on conflict (guild_id, client_request_id) do update set client_request_id = excluded.client_request_id
       returning *`,
      [guildId, actorUserId, operationType, targetId, clientRequestId,
        confirmationPhrase, json(preview), json(payload), correlationId],
    );
    return rows[0];
  }

  async completeOperation({ id, result, errorCode = null, metadata = {} }) {
    const { rows } = await this.pool.query(
      `update admin_operations
          set result = $2, error_code = $3, metadata = $4::jsonb,
              completed_at = now()
        where id = $1
      returning *`,
      [id, result, errorCode, json(metadata)],
    );
    return rows[0] ?? null;
  }

  async createCase({
    guildId,
    targetUserId,
    actorUserId,
    action,
    reason,
    durationSeconds = null,
    deleteMessageSeconds = null,
    channelId = null,
    messageCount = null,
    dmRequested = false,
    correlationId = randomUUID(),
    metadata = {},
  }) {
    const { rows } = await this.pool.query(
      `insert into moderation_cases
        (guild_id, target_user_id, actor_user_id, action, reason,
         duration_seconds, delete_message_seconds, channel_id, message_count,
         dm_requested, correlation_id, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       returning *`,
      [guildId, targetUserId, actorUserId, action, reason,
        durationSeconds, deleteMessageSeconds, channelId, messageCount,
        dmRequested, correlationId, json(metadata)],
    );
    return rows[0];
  }

  async completeCase({ id, result, dmStatus = null, discordLogStatus = null, errorCode = null, metadata = {} }) {
    const { rows } = await this.pool.query(
      `update moderation_cases
          set result = $2,
              dm_status = coalesce($3, dm_status),
              discord_log_status = coalesce($4, discord_log_status),
              error_code = $5,
              metadata = $6::jsonb,
              completed_at = now()
        where id = $1
      returning *`,
      [id, result, dmStatus, discordLogStatus, errorCode, json(metadata)],
    );
    return rows[0] ?? null;
  }

  async listCases({ guildId, limit = 100, before = null, targetUserId = null }) {
    const { rows } = await this.pool.query(
      `select * from moderation_cases
        where guild_id = $1
          and ($2::timestamptz is null or created_at < $2)
          and ($3::text is null or target_user_id = $3)
        order by created_at desc
        limit $4`,
      [guildId, before, targetUserId, Math.min(Math.max(limit, 1), 200)],
    );
    return rows;
  }

  async listOperations({ guildId, limit = 100, before = null }) {
    const { rows } = await this.pool.query(
      `select * from admin_operations
        where guild_id = $1
          and ($2::timestamptz is null or created_at < $2)
        order by created_at desc
        limit $3`,
      [guildId, before, Math.min(Math.max(limit, 1), 200)],
    );
    return rows;
  }
}

module.exports = { AdminRepository };
