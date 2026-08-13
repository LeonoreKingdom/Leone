const { randomUUID } = require('node:crypto');

function json(value) { return JSON.stringify(value ?? {}); }

class KnowledgeRepository {
  constructor(pool) { this.pool = pool; }

  async getSettings(guildId, defaults = {}) {
    const { rows } = await this.pool.query('select * from chatbot_settings where guild_id = $1', [guildId]);
    return rows[0] ?? { guild_id: guildId, enabled: false, channel_ids: [], trigger_mode: 'mention_dm', retention_days: 30, per_user_cooldown_seconds: defaults.cooldown ?? 15, daily_request_limit: defaults.dailyLimit ?? 500, model: defaults.model ?? null };
  }

  async upsertSettings(guildId, input) {
    const { rows } = await this.pool.query(`insert into chatbot_settings (guild_id, enabled, channel_ids, trigger_mode, retention_days, per_user_cooldown_seconds, daily_request_limit, model, ingestion_started_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,case when $2 then coalesce((select ingestion_started_at from chatbot_settings where guild_id = $1), now()) else (select ingestion_started_at from chatbot_settings where guild_id = $1) end, now())
      on conflict (guild_id) do update set enabled=excluded.enabled, channel_ids=excluded.channel_ids, trigger_mode=excluded.trigger_mode, retention_days=excluded.retention_days, per_user_cooldown_seconds=excluded.per_user_cooldown_seconds, daily_request_limit=excluded.daily_request_limit, model=excluded.model, ingestion_started_at=excluded.ingestion_started_at, updated_at=now()
      returning *`, [guildId, input.enabled, input.channelIds, input.triggerMode, input.retentionDays, input.perUserCooldownSeconds, input.dailyRequestLimit, input.model || null]);
    return rows[0];
  }

  async saveCanonicalDocuments(guildId, documents) {
    await this.pool.query('delete from knowledge_chunks where guild_id = $1 and source_type = $2', [guildId, 'canonical']);
    await this.pool.query('delete from knowledge_documents where guild_id = $1', [guildId]);
    let chunks = 0;
    for (const document of documents) {
      const { rows } = await this.pool.query(`insert into knowledge_documents (guild_id, source_type, source_key, title, content, version) values ($1,$2,$3,$4,$5,$6) returning id`, [guildId, document.sourceType, document.sourceKey, document.title, document.content, document.version ?? 1]);
      const id = rows[0].id;
      for (const content of splitText(document.content)) {
        await this.pool.query(`insert into knowledge_chunks (guild_id, document_id, source_type, content, metadata) values ($1,$2,'canonical',$3,$4::jsonb)`, [guildId, id, content, json({ title: document.title, sourceKey: document.sourceKey })]);
        chunks += 1;
      }
    }
    await this.pool.query('update chatbot_settings set last_indexed_at = now(), updated_at = now() where guild_id = $1', [guildId]);
    return { documents: documents.length, chunks };
  }

  async ingestMessage({ guildId, channelId, messageId, content, retentionDays }) {
    const expiresAt = new Date(Date.now() + Number(retentionDays) * 86400000);
    const { rows } = await this.pool.query(`insert into knowledge_chunks (id, guild_id, source_type, channel_id, message_id, content, metadata, expires_at) values ($1,$2,'message',$3,$4,$5,$6::jsonb,$7) on conflict (guild_id, channel_id, message_id) where source_type = 'message' and message_id is not null do nothing returning id`, [randomUUID(), guildId, channelId, messageId, content, json({ redacted: true }), expiresAt]);
    return rows[0] ?? null;
  }

  async search({ guildId, query, channelId = null, limit = 8 }) {
    if (!query) return [];
    const { rows } = await this.pool.query(`select id, source_type, channel_id, content, metadata, ts_rank(search_vector, websearch_to_tsquery('simple', $2)) as rank
      from knowledge_chunks where guild_id = $1 and (expires_at is null or expires_at > now())
      and (source_type = 'canonical' or ($3::text is not null and channel_id = $3))
      and search_vector @@ websearch_to_tsquery('simple', $2)
      order by rank desc, created_at desc limit $4`, [guildId, query.slice(0, 500), channelId, Math.min(Math.max(limit, 1), 8)]);
    return rows;
  }

  async usageCount(guildId, since) {
    const { rows } = await this.pool.query(`select count(*)::int as count from chat_usage where guild_id = $1 and created_at >= $2 and result = 'success'`, [guildId, since]);
    return rows[0]?.count ?? 0;
  }

  async recordUsage(payload) {
    await this.pool.query(`insert into chat_usage (guild_id,user_id,channel_id,model,request_tokens,response_tokens,latency_ms,result,error_code) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [payload.guildId, payload.userId, payload.channelId ?? null, payload.model ?? null, payload.requestTokens ?? null, payload.responseTokens ?? null, payload.latencyMs ?? null, payload.result, payload.errorCode ?? null]);
  }

  async status(guildId) {
    const { rows } = await this.pool.query(`select (select count(*)::int from knowledge_documents where guild_id = $1 and enabled) as documents, (select count(*)::int from knowledge_chunks where guild_id = $1 and source_type = 'canonical') as canonical_chunks, (select count(*)::int from knowledge_chunks where guild_id = $1 and source_type = 'message' and (expires_at is null or expires_at > now())) as message_chunks, (select max(created_at) from knowledge_chunks where guild_id = $1) as last_ingestion, (select max(last_indexed_at) from chatbot_settings where guild_id = $1) as last_indexed, (select max(worker_last_seen_at) from chatbot_settings where guild_id = $1) as worker_last_seen`, [guildId]);
    return rows[0] ?? {};
  }

  async touchWorker(guildId) {
    await this.pool.query('insert into chatbot_settings (guild_id, worker_last_seen_at) values ($1, now()) on conflict (guild_id) do update set worker_last_seen_at = now()', [guildId]);
  }

  async purgeMessageKnowledge(guildId) {
    const result = await this.pool.query("delete from knowledge_chunks where guild_id = $1 and source_type = 'message'", [guildId]);
    return { deleted: result.rowCount ?? 0 };
  }

  async purgeMessageKnowledgeForChannels(guildId, channelIds) {
    if (!channelIds?.length) return { deleted: 0 };
    const result = await this.pool.query("delete from knowledge_chunks where guild_id = $1 and source_type = 'message' and channel_id = any($2::text[])", [guildId, channelIds]);
    return { deleted: result.rowCount ?? 0 };
  }
}

function splitText(text, size = 1500) {
  const value = String(text ?? '').trim();
  if (!value) return [];
  const chunks = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks;
}

module.exports = { KnowledgeRepository, splitText };
