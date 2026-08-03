create table if not exists data_imports (
  id uuid primary key default extensions.gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  source_name text not null,
  source_checksum text not null,
  counts jsonb not null,
  imported_at timestamptz not null default now(),
  unique (guild_id, source_name, source_checksum)
);

alter table data_imports enable row level security;
revoke all on data_imports from anon, authenticated;

create or replace function invoke_leone_greetings_dispatch()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  endpoint text;
  scheduler_secret text;
  request_id bigint;
begin
  select decrypted_secret into endpoint
    from vault.decrypted_secrets where name = 'leone_dispatch_url';
  select decrypted_secret into scheduler_secret
    from vault.decrypted_secrets where name = 'leone_scheduler_secret';
  if endpoint is null or scheduler_secret is null then
    raise exception 'Leone dispatcher Vault secrets are not configured';
  end if;
  select net.http_post(
    url := endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || scheduler_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function invoke_leone_greetings_dispatch() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'leone-retention-daily') then
    perform cron.schedule(
      'leone-retention-daily',
      '17 2 * * *',
      'select public.purge_expired_leone_data();'
    );
  end if;
end;
$$;
