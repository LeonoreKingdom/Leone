alter table guild_capability_roles
  drop constraint if exists guild_capability_roles_capability_check;

alter table guild_capability_roles
  add constraint guild_capability_roles_capability_check check (capability in (
    'admin.read', 'config.write', 'greetings.manage',
    'audit.read', 'relationships.abuse',
    'moderation.read', 'moderation.warn', 'moderation.timeout',
    'moderation.kick', 'moderation.ban', 'moderation.messages',
    'server.roles.read', 'server.roles.assign', 'server.roles.manage',
    'server.channels.read', 'server.channels.manage'
  ));

create table if not exists moderation_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  case_number bigint generated always as identity,
  target_user_id text not null check (target_user_id ~ '^[0-9]+$'),
  actor_user_id text not null check (actor_user_id ~ '^[0-9]+$'),
  action text not null check (action in ('warn','timeout','untimeout','kick','ban','unban','purge')),
  reason text not null check (char_length(reason) between 1 and 512),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 2419200),
  delete_message_seconds integer check (delete_message_seconds is null or delete_message_seconds between 0 and 604800),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]+$'),
  message_count integer check (message_count is null or message_count between 1 and 100),
  result text not null default 'pending' check (result in ('pending','success','failed','partial')),
  dm_requested boolean not null default false,
  dm_status text not null default 'not_requested' check (dm_status in ('not_requested','sent','failed')),
  discord_log_status text not null default 'not_configured' check (discord_log_status in ('not_configured','sent','failed')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists moderation_cases_guild_created_idx
  on moderation_cases (guild_id, created_at desc);
create index if not exists moderation_cases_target_idx
  on moderation_cases (guild_id, target_user_id, created_at desc);

create table if not exists admin_operations (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  actor_user_id text not null check (actor_user_id ~ '^[0-9]+$'),
  operation_type text not null check (operation_type in ('moderation','role_assign','role_remove','role_create','role_update','channel_create','channel_update','channel_archive')),
  target_id text,
  client_request_id uuid not null,
  confirmation_phrase text,
  preview jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  result text not null default 'pending' check (result in ('pending','success','failed','partial')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (guild_id, client_request_id)
);

create index if not exists admin_operations_guild_created_idx
  on admin_operations (guild_id, created_at desc);

alter table moderation_cases enable row level security;
alter table admin_operations enable row level security;

grant select, insert, update on moderation_cases, admin_operations to leone_runtime;

create policy leone_runtime_all on moderation_cases
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on admin_operations
  for all to leone_runtime using (true) with check (true);
