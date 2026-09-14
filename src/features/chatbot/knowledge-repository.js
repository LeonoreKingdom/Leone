const { randomUUID } = require('node:crypto');
const {
  DEFAULT_KNOWLEDGE_INDEX,
  DEFAULT_RESPONSE_RULES,
  DEFAULT_RESPONSE_STYLE,
} = require('./persona-config');

function json(value) { return JSON.stringify(value ?? {}); }

const SEARCH_STOPWORDS = new Set([
  'apa', 'apakah', 'bagaimana', 'bisa', 'boleh', 'dapat', 'dengan', 'dan', 'dari', 'di',
  'jelaskan', 'jelaskanlah', 'mohon', 'untuk', 'yang', 'ini', 'itu', 'the', 'what', 'how',
  'can', 'could', 'please', 'about', 'tell', 'this', 'that', 'with', 'from', 'are',
]);

function buildBroadTsQuery(query) {
  const terms = String(query ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const uniqueTerms = [...new Set(terms.filter((term) => !SEARCH_STOPWORDS.has(term)))].slice(0, 24);
  return uniqueTerms.map((term) => `${term}:*`).join(' | ') || null;
}

class KnowledgeRepository {
  constructor(pool) { this.pool = pool; }

  async getSettings(guildId, defaults = {}) {
    const { rows } = await this.pool.query('select * from chatbot_settings where guild_id = $1', [guildId]);
    return rows[0] ?? {
      guild_id: guildId,
      enabled: false,
      channel_ids: [],
      trigger_mode: 'mention_dm',
      retention_days: 30,
      per_user_cooldown_seconds: defaults.cooldown ?? 8,
      daily_request_limit: defaults.dailyLimit ?? 300,
      model: defaults.model ?? null,
      knowledge_index: defaults.knowledgeIndex ?? DEFAULT_KNOWLEDGE_INDEX,
      response_style: defaults.responseStyle ?? DEFAULT_RESPONSE_STYLE,
      response_rules: defaults.responseRules ?? DEFAULT_RESPONSE_RULES,
    };
  }

  async upsertSettings(guildId, input) {
    const { rows } = await this.pool.query(`insert into chatbot_settings (guild_id, enabled, channel_ids, trigger_mode, retention_days, per_user_cooldown_seconds, daily_request_limit, model, knowledge_index, response_style, response_rules, ingestion_started_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $2 then coalesce((select ingestion_started_at from chatbot_settings where guild_id = $1), now()) else (select ingestion_started_at from chatbot_settings where guild_id = $1) end, now())
      on conflict (guild_id) do update set enabled=excluded.enabled, channel_ids=excluded.channel_ids, trigger_mode=excluded.trigger_mode, retention_days=excluded.retention_days, per_user_cooldown_seconds=excluded.per_user_cooldown_seconds, daily_request_limit=excluded.daily_request_limit, model=excluded.model, knowledge_index=excluded.knowledge_index, response_style=excluded.response_style, response_rules=excluded.response_rules, ingestion_started_at=excluded.ingestion_started_at, updated_at=now()
      returning *`, [guildId, input.enabled, input.channelIds, input.triggerMode, input.retentionDays, input.perUserCooldownSeconds, input.dailyRequestLimit, input.model || null, input.knowledgeIndex ?? DEFAULT_KNOWLEDGE_INDEX, input.responseStyle ?? DEFAULT_RESPONSE_STYLE, input.responseRules ?? DEFAULT_RESPONSE_RULES]);
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
    const searchQuery = query.slice(0, 500);
    const broadQuery = buildBroadTsQuery(searchQuery);
    const { rows } = await this.pool.query(`with parsed as (
        select websearch_to_tsquery('simple', $2) as strict_query,
               case when $3::text is not null then to_tsquery('simple', $3) end as broad_query
      )
      select id, source_type, channel_id, content, metadata,
        ts_rank(search_vector, strict_query) + coalesce(ts_rank(search_vector, broad_query), 0) as rank
      from knowledge_chunks, parsed
      where guild_id = $1 and (expires_at is null or expires_at > now())
      and (source_type = 'canonical' or ($4::text is not null and channel_id = $4))
      and (search_vector @@ strict_query or (broad_query is not null and search_vector @@ broad_query))
      order by rank desc, created_at desc limit $5`, [guildId, searchQuery, broadQuery, channelId, Math.min(Math.max(limit, 1), 8)]);
    return rows;
  }

  async usageCount(guildId, since) {
    const { rows } = await this.pool.query(`select count(*)::int as count from chat_usage where guild_id = $1 and created_at >= $2 and result = 'success'`, [guildId, since]);
    return rows[0]?.count ?? 0;
  }

  async recordUsage(payload) {
    await this.pool.query(`insert into chat_usage (guild_id,user_id,channel_id,model,request_tokens,response_tokens,latency_ms,result,error_code) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [payload.guildId, payload.userId, payload.channelId ?? null, payload.model ?? null, payload.requestTokens ?? null, payload.responseTokens ?? null, payload.latencyMs ?? null, payload.result, payload.errorCode ?? null]);
  }

  async usageSummary(guildId) {
    const [totalsResult, modelsResult, recentResult] = await Promise.all([
      this.pool.query(`select
          count(*) filter (where created_at >= date_trunc('day', now()) and result = 'success')::int as today_successful_requests,
          coalesce(sum(request_tokens) filter (where created_at >= date_trunc('day', now()) and result = 'success'), 0)::int as today_input_tokens,
          coalesce(sum(response_tokens) filter (where created_at >= date_trunc('day', now()) and result = 'success'), 0)::int as today_output_tokens,
          count(*) filter (where created_at >= date_trunc('day', now()) and result = 'rate_limited')::int as today_app_rate_limited,
          count(*) filter (where created_at >= date_trunc('day', now()) and result = 'error')::int as today_errors,
          round(avg(latency_ms) filter (where created_at >= date_trunc('day', now()) and result = 'success'))::int as today_avg_latency_ms,
          count(*) filter (where result = 'success')::int as seven_day_successful_requests,
          coalesce(sum(request_tokens) filter (where result = 'success'), 0)::int as seven_day_input_tokens,
          coalesce(sum(response_tokens) filter (where result = 'success'), 0)::int as seven_day_output_tokens,
          count(*) filter (where result = 'rate_limited')::int as seven_day_app_rate_limited,
          count(*) filter (where result = 'error')::int as seven_day_errors,
          round(avg(latency_ms) filter (where result = 'success'))::int as seven_day_avg_latency_ms,
          count(*) filter (where created_at >= now() - interval '24 hours' and error_code = 'GEMINI_RATE_LIMITED')::int as provider_rate_limited_24h,
          count(*) filter (where created_at >= now() - interval '24 hours' and error_code = 'GEMINI_TEMPORARILY_UNAVAILABLE')::int as provider_high_demand_24h,
          count(*) filter (where created_at >= now() - interval '7 days' and error_code = 'GEMINI_RATE_LIMITED')::int as provider_rate_limited_7d,
          count(*) filter (where created_at >= now() - interval '7 days' and error_code = 'GEMINI_TEMPORARILY_UNAVAILABLE')::int as provider_high_demand_7d,
          max(created_at) as last_request_at
        from chat_usage
        where guild_id = $1 and created_at >= now() - interval '7 days'`, [guildId]),
      this.pool.query(`select coalesce(model, 'unknown') as model, count(*)::int as requests,
          coalesce(sum(request_tokens), 0)::int as input_tokens,
          coalesce(sum(response_tokens), 0)::int as output_tokens,
          round(avg(latency_ms))::int as avg_latency_ms
        from chat_usage
        where guild_id = $1 and result = 'success' and created_at >= now() - interval '7 days'
        group by model order by requests desc, model`, [guildId]),
      this.pool.query(`select created_at, model, result, error_code, latency_ms
        from chat_usage where guild_id = $1 order by created_at desc limit 12`, [guildId]),
    ]);
    const totals = totalsResult.rows[0] ?? {};
    return {
      today: {
        successfulRequests: totals.today_successful_requests ?? 0,
        inputTokens: totals.today_input_tokens ?? 0,
        outputTokens: totals.today_output_tokens ?? 0,
        appRateLimited: totals.today_app_rate_limited ?? 0,
        errors: totals.today_errors ?? 0,
        averageLatencyMs: totals.today_avg_latency_ms ?? null,
      },
      sevenDays: {
        successfulRequests: totals.seven_day_successful_requests ?? 0,
        inputTokens: totals.seven_day_input_tokens ?? 0,
        outputTokens: totals.seven_day_output_tokens ?? 0,
        appRateLimited: totals.seven_day_app_rate_limited ?? 0,
        errors: totals.seven_day_errors ?? 0,
        averageLatencyMs: totals.seven_day_avg_latency_ms ?? null,
      },
      providerSignals: {
        rateLimited24h: totals.provider_rate_limited_24h ?? 0,
        highDemand24h: totals.provider_high_demand_24h ?? 0,
        rateLimited7d: totals.provider_rate_limited_7d ?? 0,
        highDemand7d: totals.provider_high_demand_7d ?? 0,
      },
      models: modelsResult.rows,
      recent: recentResult.rows,
      lastRequestAt: totals.last_request_at ?? null,
    };
  }

  async status(guildId) {
    const { rows } = await this.pool.query(`select (select count(*)::int from knowledge_documents where guild_id = $1 and enabled) as documents, (select coalesce(min(version), 0)::int from knowledge_documents where guild_id = $1 and enabled) as canonical_version, (select count(*)::int from knowledge_chunks where guild_id = $1 and source_type = 'canonical') as canonical_chunks, (select count(*)::int from knowledge_chunks where guild_id = $1 and source_type = 'message' and (expires_at is null or expires_at > now())) as message_chunks, (select max(created_at) from knowledge_chunks where guild_id = $1) as last_ingestion, (select max(last_indexed_at) from chatbot_settings where guild_id = $1) as last_indexed, (select max(worker_last_seen_at) from chatbot_settings where guild_id = $1) as worker_last_seen`, [guildId]);
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

module.exports = { KnowledgeRepository, buildBroadTsQuery, splitText };
