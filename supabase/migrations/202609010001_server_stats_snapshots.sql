create table if not exists server_stats_snapshots (
  guild_id text primary key references guilds(id) on delete cascade,
  name text not null,
  member_count integer check (member_count is null or member_count >= 0),
  citizen_count integer check (citizen_count is null or citizen_count >= 0),
  online_count integer check (online_count is null or online_count >= 0),
  in_voice_count integer check (in_voice_count is null or in_voice_count >= 0),
  bot_count integer check (bot_count is null or bot_count >= 0),
  icon_url text,
  profiles jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
