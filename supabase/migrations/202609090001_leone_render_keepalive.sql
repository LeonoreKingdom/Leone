-- Defines the Render keepalive call. The Vault URL and cron schedule are
-- intentionally provisioned separately so no deployment secret enters git.
create or replace function public.invoke_leone_render_keepalive()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  endpoint text;
  request_id bigint;
begin
  select decrypted_secret into endpoint
    from vault.decrypted_secrets
   where name = 'leone_render_wake_url';
  if endpoint is null then
    raise exception 'Leone Render keepalive Vault secret is not configured';
  end if;
  select net.http_get(
    url := endpoint,
    headers := jsonb_build_object('User-Agent', 'Leone-Supabase-Keepalive'),
    timeout_milliseconds := 5000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.invoke_leone_render_keepalive() from public, anon, authenticated;
