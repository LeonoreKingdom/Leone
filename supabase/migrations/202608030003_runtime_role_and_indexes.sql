do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'leone_runtime') then
    create role leone_runtime
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication;
  end if;
end;
$$;

alter role leone_runtime set statement_timeout = '15s';
alter role leone_runtime set lock_timeout = '5s';
alter role leone_runtime set idle_in_transaction_session_timeout = '15s';

grant usage on schema public, extensions to leone_runtime;

grant select, insert, update, delete on
  guilds,
  guild_capability_roles,
  member_privacy,
  bond_blocks,
  bond_requests,
  bonds,
  greeting_templates,
  greeting_quotes,
  greeting_schedules,
  greeting_runs,
  oauth_sessions
to leone_runtime;

grant select, insert on audit_events, data_imports to leone_runtime;

create policy leone_runtime_all on guilds
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on guild_capability_roles
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on member_privacy
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on bond_blocks
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on bond_requests
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on bonds
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on greeting_templates
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on greeting_quotes
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on greeting_schedules
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on greeting_runs
  for all to leone_runtime using (true) with check (true);
create policy leone_runtime_all on oauth_sessions
  for all to leone_runtime using (true) with check (true);

create policy leone_runtime_select on audit_events
  for select to leone_runtime using (true);
create policy leone_runtime_insert on audit_events
  for insert to leone_runtime with check (true);
create policy leone_runtime_select on data_imports
  for select to leone_runtime using (true);
create policy leone_runtime_insert on data_imports
  for insert to leone_runtime with check (true);

create index if not exists greeting_schedules_template_idx
  on greeting_schedules (template_id)
  where template_id is not null;

create index if not exists oauth_sessions_guild_idx
  on oauth_sessions (guild_id);
