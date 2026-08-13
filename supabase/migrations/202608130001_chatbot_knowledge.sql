alter table guild_capability_roles
  drop constraint if exists guild_capability_roles_capability_check;

alter table guild_capability_roles
  add constraint guild_capability_roles_capability_check check (capability in (
    'admin.read', 'config.write', 'greetings.manage', 'audit.read', 'relationships.abuse',
    'moderation.read', 'moderation.warn', 'moderation.timeout', 'moderation.kick',
    'moderation.ban', 'moderation.messages', 'server.roles.read', 'server.roles.assign',
    'server.roles.manage', 'server.channels.read', 'server.channels.manage', 'chatbot.manage'
  ));

create table if not exists chatbot_settings (
  guild_id text primary key references guilds(id) on delete cascade,
  enabled boolean not null default false,
  channel_ids text[] not null default '{}',
  trigger_mode text not null default 'mention_dm' check (trigger_mode in ('mention_dm','auto_response')),
  retention_days integer not null default 30 check (retention_days in (7,14,30)),
  per_user_cooldown_seconds integer not null default 15 check (per_user_cooldown_seconds between 0 and 3600),
  daily_request_limit integer not null default 500 check (daily_request_limit between 0 and 100000),
  model text,
  ingestion_started_at timestamptz,
  last_indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists knowledge_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  source_type text not null check (source_type in ('canonical','faq','rules','channel','role','staff','command','event')),
  source_key text not null,
  title text not null,
  content text not null,
  version integer not null default 1 check (version > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, source_key, version)
);

create table if not exists knowledge_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  document_id uuid references knowledge_documents(id) on delete cascade,
  source_type text not null check (source_type in ('canonical', 'message')),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]+$'),
  message_id text check (message_id is null or message_id ~ '^[0-9]+$'),
  content text not null check (char_length(content) between 1 and 4000),
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists chat_usage (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  user_id text not null check (user_id ~ '^[0-9]+$'),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]+$'),
  model text,
  request_tokens integer,
  response_tokens integer,
  latency_ms integer,
  result text not null check (result in ('success','rate_limited','disabled','error','ignored')),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_search_idx on knowledge_chunks using gin(search_vector);
create index if not exists knowledge_chunks_document_idx on knowledge_chunks (document_id);
create index if not exists knowledge_chunks_scope_idx on knowledge_chunks (guild_id, channel_id, expires_at, created_at desc);
create index if not exists chat_usage_guild_created_idx on chat_usage (guild_id, created_at desc);
create index if not exists chat_usage_user_created_idx on chat_usage (guild_id, user_id, created_at desc);
create unique index if not exists knowledge_chunks_message_unique_idx on knowledge_chunks (guild_id, channel_id, message_id) where source_type = 'message' and message_id is not null;

alter table chatbot_settings enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;
alter table chat_usage enable row level security;

revoke all on chatbot_settings, knowledge_documents, knowledge_chunks, chat_usage from anon, authenticated;
grant select, insert, update, delete on chatbot_settings, knowledge_documents, knowledge_chunks, chat_usage to leone_runtime;

drop policy if exists leone_runtime_all on chatbot_settings;
drop policy if exists leone_runtime_all on knowledge_documents;
drop policy if exists leone_runtime_all on knowledge_chunks;
drop policy if exists leone_runtime_all on chat_usage;
create policy leone_runtime_all on chatbot_settings for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on knowledge_documents for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on knowledge_chunks for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on chat_usage for all to leone_runtime using (true) with check (true);

create or replace function purge_expired_leone_knowledge()
returns void language sql security definer set search_path = public, extensions
as $$
  delete from knowledge_chunks
   where source_type = 'message'
     and expires_at is not null
     and expires_at <= now();
$$;
revoke all on function purge_expired_leone_knowledge() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'leone-chatbot-retention-daily') then
    perform cron.schedule('leone-chatbot-retention-daily', '30 2 * * *', 'select public.purge_expired_leone_knowledge();');
  end if;
end;
$$;
