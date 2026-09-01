function toSnapshot(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    name: row.name,
    memberCount: row.member_count == null ? null : Number(row.member_count),
    citizenCount: row.citizen_count == null ? null : Number(row.citizen_count),
    onlineCount: row.online_count == null ? null : Number(row.online_count),
    inVoiceCount: row.in_voice_count == null ? null : Number(row.in_voice_count),
    botCount: row.bot_count == null ? null : Number(row.bot_count),
    iconUrl: row.icon_url ?? null,
    profiles: Array.isArray(row.profiles) ? row.profiles : [],
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

class ServerStatsSnapshotRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get(guildId) {
    const result = await this.pool.query(
      `select guild_id, name, member_count, citizen_count, online_count,
              in_voice_count, bot_count, icon_url, profiles, updated_at
         from server_stats_snapshots
        where guild_id = $1`,
      [guildId],
    );
    return toSnapshot(result.rows[0]);
  }

  async upsert(snapshot) {
    await this.pool.query(
      `insert into server_stats_snapshots (
         guild_id, name, member_count, citizen_count, online_count,
         in_voice_count, bot_count, icon_url, profiles, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       on conflict (guild_id) do update set
         name = excluded.name,
         member_count = excluded.member_count,
         citizen_count = excluded.citizen_count,
         online_count = excluded.online_count,
         in_voice_count = excluded.in_voice_count,
         bot_count = excluded.bot_count,
         icon_url = excluded.icon_url,
         profiles = excluded.profiles,
         updated_at = excluded.updated_at`,
      [
        snapshot.guildId,
        snapshot.name,
        snapshot.memberCount,
        snapshot.citizenCount,
        snapshot.onlineCount,
        snapshot.inVoiceCount,
        snapshot.botCount,
        snapshot.iconUrl,
        JSON.stringify(snapshot.profiles ?? []),
        snapshot.updatedAt,
      ],
    );
  }
}

module.exports = { ServerStatsSnapshotRepository, toSnapshot };
