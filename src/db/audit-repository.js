const { randomUUID } = require('node:crypto');

class AuditRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async record({
    guildId,
    actorUserId = null,
    action,
    targetCategory,
    targetId = null,
    result = 'success',
    reason = null,
    metadata = {},
    correlationId = randomUUID(),
  }) {
    const query = `
      insert into audit_events (
        guild_id, actor_user_id, action, target_category,
        target_id, result, reason, metadata, correlation_id
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
      returning id, created_at
    `;
    const values = [
      guildId,
      actorUserId,
      action,
      targetCategory,
      targetId,
      result,
      reason,
      JSON.stringify(metadata),
      correlationId,
    ];
    const { rows } = await this.pool.query(query, values);
    return { ...rows[0], correlationId };
  }

  async list({ guildId, limit = 100, before = null }) {
    const { rows } = await this.pool.query(
      `select id, actor_user_id, action, target_category, target_id,
              result, reason, metadata, correlation_id, created_at
         from audit_events
        where guild_id = $1
          and ($2::timestamptz is null or created_at < $2)
        order by created_at desc
        limit $3`,
      [guildId, before, Math.min(Math.max(limit, 1), 200)],
    );
    return rows;
  }
}

module.exports = { AuditRepository };
