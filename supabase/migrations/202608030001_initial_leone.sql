create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists guilds (
  id text primary key check (id ~ '^[0-9]+$'),
  name text not null,
  owner_user_id text check (owner_user_id is null or owner_user_id ~ '^[0-9]+$'),
  scheduler_enabled boolean not null default false,
  maintenance_mode boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists guild_capability_roles (
  guild_id text not null references guilds(id) on delete cascade,
  role_id text not null check (role_id ~ '^[0-9]+$'),
  capability text not null check (capability in (
    'admin.read', 'config.write', 'greetings.manage',
    'audit.read', 'relationships.abuse'
  )),
  created_at timestamptz not null default now(),
  primary key (guild_id, role_id, capability)
);

create table if not exists member_privacy (
  guild_id text not null references guilds(id) on delete cascade,
  user_id text not null check (user_id ~ '^[0-9]+$'),
  visibility text not null default 'private'
    check (visibility in ('private', 'bonds', 'public')),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create table if not exists bond_blocks (
  guild_id text not null references guilds(id) on delete cascade,
  blocker_user_id text not null check (blocker_user_id ~ '^[0-9]+$'),
  blocked_user_id text not null check (blocked_user_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  primary key (guild_id, blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

create table if not exists bond_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  requester_user_id text not null check (requester_user_id ~ '^[0-9]+$'),
  target_user_id text not null check (target_user_id ~ '^[0-9]+$'),
  requested_type text not null check (requested_type in (
    'partner', 'parent', 'child', 'sibling', 'best-friend',
    'mentor', 'apprentice', 'friendly-rival', 'found-family'
  )),
  relationship_type text not null check (relationship_type in (
    'partner', 'parent', 'sibling', 'best-friend',
    'mentor', 'friendly-rival', 'found-family'
  )),
  from_user_id text not null check (from_user_id ~ '^[0-9]+$'),
  to_user_id text not null check (to_user_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (requester_user_id <> target_user_id),
  check (from_user_id <> to_user_id),
  unique (guild_id, relationship_type, from_user_id, to_user_id)
);

create index if not exists bond_requests_target_idx
  on bond_requests (guild_id, target_user_id, expires_at);
create index if not exists bond_requests_expiry_idx
  on bond_requests (expires_at);

create table if not exists bonds (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'partner', 'parent', 'sibling', 'best-friend',
    'mentor', 'friendly-rival', 'found-family'
  )),
  from_user_id text not null check (from_user_id ~ '^[0-9]+$'),
  to_user_id text not null check (to_user_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  unique (guild_id, relationship_type, from_user_id, to_user_id)
);

create index if not exists bonds_from_idx
  on bonds (guild_id, from_user_id);
create index if not exists bonds_to_idx
  on bonds (guild_id, to_user_id);

create table if not exists greeting_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  name text not null,
  occasion text not null check (occasion in (
    'morning', 'afternoon', 'evening', 'night', 'custom'
  )),
  version integer not null default 1 check (version > 0),
  content jsonb not null,
  enabled boolean not null default true,
  created_by_user_id text check (created_by_user_id is null or created_by_user_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  unique (guild_id, name, version)
);

create table if not exists greeting_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  author text not null check (char_length(author) between 1 and 100),
  mood_tags text[] not null default '{}',
  approved boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (guild_id, text, author)
);

create table if not exists greeting_schedules (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  name text not null,
  channel_id text not null check (channel_id ~ '^[0-9]+$'),
  role_id text not null check (role_id ~ '^[0-9]+$'),
  occasion text not null check (occasion in (
    'morning', 'afternoon', 'evening', 'night', 'custom'
  )),
  timezone text not null default 'Asia/Jakarta',
  local_time time not null,
  days_of_week smallint[] not null default array[1,2,3,4,5,6,7]::smallint[],
  template_id uuid references greeting_templates(id) on delete set null,
  adm4 text,
  location_label text,
  grace_minutes integer not null default 15 check (grace_minutes between 0 and 120),
  enabled boolean not null default false,
  created_by_user_id text not null check (created_by_user_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, name),
  check (cardinality(days_of_week) between 1 and 7),
  check (days_of_week <@ array[1,2,3,4,5,6,7]::smallint[])
);

create table if not exists greeting_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  schedule_id uuid not null references greeting_schedules(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null check (status in (
    'claimed', 'sent', 'missed', 'failed', 'unknown'
  )),
  discord_message_id text check (discord_message_id is null or discord_message_id ~ '^[0-9]+$'),
  provider_status jsonb not null default '{}'::jsonb,
  error_code text,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (schedule_id, scheduled_for)
);

create index if not exists greeting_runs_status_idx
  on greeting_runs (status, claimed_at);

create table if not exists oauth_sessions (
  session_hash text primary key,
  csrf_hash text not null,
  guild_id text not null references guilds(id) on delete cascade,
  user_id text not null check (user_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists oauth_sessions_expiry_idx
  on oauth_sessions (expires_at);

create table if not exists audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  actor_user_id text check (actor_user_id is null or actor_user_id ~ '^[0-9]+$'),
  action text not null,
  target_category text not null,
  target_id text,
  result text not null default 'success',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_guild_created_idx
  on audit_events (guild_id, created_at desc);

alter table guilds enable row level security;
alter table guild_capability_roles enable row level security;
alter table member_privacy enable row level security;
alter table bond_blocks enable row level security;
alter table bond_requests enable row level security;
alter table bonds enable row level security;
alter table greeting_templates enable row level security;
alter table greeting_quotes enable row level security;
alter table greeting_schedules enable row level security;
alter table greeting_runs enable row level security;
alter table oauth_sessions enable row level security;
alter table audit_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;

create or replace function purge_expired_leone_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from bond_requests where expires_at <= now();
  delete from oauth_sessions where expires_at <= now();
  delete from greeting_runs
   where coalesce(completed_at, claimed_at) < now() - interval '90 days';
  delete from audit_events where created_at < now() - interval '180 days';
end;
$$;

revoke all on function purge_expired_leone_data() from public, anon, authenticated;
