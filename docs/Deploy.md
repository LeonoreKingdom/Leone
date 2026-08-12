# Leone Deployment and Operations

This runbook targets the free-first beta topology:

- React/Vite, Express, and Discord HTTP interactions on Vercel Hobby
- Supabase Free PostgreSQL in `ap-southeast-1`
- Cloudflare DNS for `bots.leonorekingdom.xyz` in DNS-only mode
- Discord guild commands and outgoing interaction webhooks

Free plans are appropriate for development and limited beta, not a guarantee of
always-on production availability or managed backups.

## Current deployed inventory (2026-08-03)

| Component | Value | State |
|---|---|---|
| Public URL | `https://bots.leonorekingdom.xyz` | Healthy |
| Vercel project | `leone` / `prj_jHwwZzpgUBkw0DBcC3V1lG6X4TRP` | Production READY |
| Production deployment | `dpl_4toHu9Kkt2qqHe7HWdTtRpZ9A3tw` | READY |
| Supabase project | `Leone` / `buzixaugbqtcmiwpwuem` | Active, Free |
| Supabase region | `ap-southeast-1` | Active |
| Discord application | `Leone` / `1532088865035124946` | 10 guild commands registered at the last deployment; source now defines 18 |
| Discord guild | `332544131693936642` | Seeded |
| Interactions endpoint | `/api/discord/interactions` | Verified by Discord |
| Scheduler | `GREETINGS_SCHEDULER_ENABLED=false` | Disabled by default |

Discord OAuth is configured. The active client secret was rotated and stored as
a sensitive Vercel environment variable, the exact redirect URI is saved in the
Developer Portal, and Production was redeployed. Logged-out
`GET /api/v1/me` now returns 401, and the owner login returns to `/admin`.

## 1. Local preflight

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
git diff --check
```

Expected baseline: 51 tests pass, Vite builds `public/`, and diff check has no
errors. Line-ending warnings on Windows are informational.

Never deploy `.env`, `data/`, database dumps, or generated secret files. Keep the
original Bonds JSON and its timestamped migration backup read-only during the
recovery window.

## 2. Supabase checklist

Project settings:

- Project ref: `buzixaugbqtcmiwpwuem`
- Region: Singapore (`ap-southeast-1`)
- Runtime connection: transaction pooler on port `6543`
- Runtime role: `leone_runtime`; do not use `postgres` or `service_role` at runtime
- SSL required

Apply migrations in filename order:

```text
202608030001_initial_leone.sql
202608030002_import_tracking_and_cron.sql
202608030003_runtime_role_and_indexes.sql
```

Post-migration checks:

```sql
select version from schema_migrations order by version;
select count(*) from guilds where id = '332544131693936642';
select count(*) from data_imports;
select count(*) from pg_policies where schemaname = 'public';
select jobname, schedule, active from cron.job order by jobname;
```

Expected beta state: one guild, one idempotent JSON import, 15 runtime policies,
and the daily retention job. Supabase security advisors should report no errors;
unused-index notices are expected on an empty/low-volume beta database.

### Bonds JSON migration

```powershell
npm.cmd run db:import-bonds -- --dry-run
npm.cmd run db:import-bonds
npm.cmd run db:import-bonds
```

The first command must reconcile source counts without writes. The first import
must create a timestamped backup and transactionally import the data. The repeat
must report `alreadyImported: true` from the checksum record.

### Scheduler opt-in

Do not create the dispatch Cron job until the owner approves the recipient role,
channel, days, and time. Generate one random scheduler secret and store the same
value in Vercel and Supabase Vault; never place it in SQL or source.

Create these Vault entries:

```sql
select vault.create_secret(
  'https://bots.leonorekingdom.xyz/api/internal/greetings/dispatch',
  'leone_dispatch_url'
);
select vault.create_secret('<same value as Vercel SCHEDULER_SECRET>',
  'leone_scheduler_secret');
```

Only after Vault configuration and UAT approval:

```sql
select cron.schedule(
  'leone-greetings-dispatch',
  '* * * * *',
  'select public.invoke_leone_greetings_dispatch();'
);
```

Emergency stop:

```sql
select cron.unschedule('leone-greetings-dispatch');
```

Also set `GREETINGS_SCHEDULER_ENABLED=false` in Vercel Production and redeploy.
The Cron removal is the primary stop; the environment flag is defense in depth.

## 3. Vercel checklist

Project configuration:

- Framework: Vite
- Build command: `npm run build`
- Output directory: `public`
- Node.js: 22 or newer
- Function: `api/index.js`
- Custom domain: `bots.leonorekingdom.xyz`

Sensitive environment variables for Production and Preview:

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | Yes | `production` in Production |
| `DATABASE_URL` | Yes | Supabase transaction pooler, runtime role, TLS |
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_CLIENT_ID` | Yes | `1532088865035124946` |
| `DISCORD_CLIENT_SECRET` | Yes for web | Active OAuth secret; rotated and configured in Production and Preview |
| `DISCORD_PUBLIC_KEY` | Yes | Discord application verification key |
| `DISCORD_GUILD_ID` | Yes | `332544131693936642` |
| `LEANNE_USER_ID` | Yes | Used for stable mentions; do not resolve by username at runtime |
| `PUBLIC_WEB_ORIGIN` | Yes | `https://bots.leonorekingdom.xyz` |
| `SESSION_SECRET` | Yes for web | At least 32 random characters |
| `SCHEDULER_SECRET` | Yes for scheduler | Random and identical to the Vault value |
| `GREETINGS_SCHEDULER_ENABLED` | Yes | Keep `false` until UAT opt-in |
| `SESSION_TTL_HOURS` | Yes | Recommended `24` |
| `TMDB_API_KEY` or `TMDB_READ_ACCESS_TOKEN` | Movie feature | Store only one if possible; Read Access Token is preferred |
| `BMKG_ADM4`, `GREETINGS_LOCATION` | Optional | Exact approved locality/display label |
| `LOG_LEVEL` | Yes | `info` normally |

Never prefix a server secret with `VITE_`; Vite-prefixed variables enter the
browser bundle.

Deployment sequence:

1. Apply compatible Supabase migrations and verify them.
2. Create a Vercel preview from the exact tested source.
3. Verify `/healthz`, the SPA, the Express API rewrite, signature rejection, and
   database connectivity.
4. Promote that preview to Production.
5. Confirm `bots.leonorekingdom.xyz` is aliased to the READY deployment.
6. Scan production runtime errors and exercise one private `/ping` command.

## 4. Cloudflare checklist

DNS record:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `bots` | `5e397c5229e8a7e0.vercel-dns-017.com` | DNS only |

Keep the record DNS-only during beta. Enabling the Cloudflare proxy changes the
request path and security boundary; repeat Discord signature, OAuth cookie, API,
and CSP UAT before enabling it. Vercel owns TLS for the current topology.

## 5. Discord Developer Portal checklist

Application `1532088865035124946`:

1. General Information → Interactions Endpoint URL:
   `https://bots.leonorekingdom.xyz/api/discord/interactions`
2. OAuth2 → Redirects:
   `https://bots.leonorekingdom.xyz/auth/discord/callback`
3. OAuth2 → Client Secret: store the active value only as Vercel's sensitive
   `DISCORD_CLIENT_SECRET`. If the existing secret is unavailable, reset it only
   with owner approval; resetting invalidates the previous value immediately.
4. Keep Public Client disabled because Leone performs a confidential
   server-side authorization-code exchange.
5. Bot permissions: never grant Administrator. Grant only permissions required
   by enabled commands and the approved channels.
6. Register the guild command manifest:

```powershell
npm.cmd run deploy:commands
```

Expected commands include `ping`, `help`, `about`, `staff`, `server-map`,
`rules`, `server`, `bonds`, `recommend`, `movie`, `anime`, `series`,
`novel`, `manga`, `manhwa`, `manhua`, `greetings`, and `weather`.

The Developer Portal, not the bot-token API, is the authoritative fallback for
endpoint and redirect settings when Discord rejects application edits from bot
credentials.

## 6. OAuth completion and verification

After configuring the secret and redirect:

1. Redeploy Production so the Vercel Function receives the new secret.
2. Open `https://bots.leonorekingdom.xyz/auth/discord`.
3. Approve only `identify` and `guilds.members.read`.
4. Verify the callback returns to `/admin` and sets a Secure, HttpOnly,
   SameSite=Lax session cookie.
5. Verify owner access, member 403 behavior, outsider rejection, CSRF rejection,
   logout, session rotation, and role-removal revocation from `UAT.md`.
6. Confirm `/api/v1/me` changes from the deliberate unconfigured 404 to 401 when
   logged out and 200 when logged in.

Production verification on 2026-08-03:

- Production redeploy `dpl_4toHu9Kkt2qqHe7HWdTtRpZ9A3tw` is READY and owns
  `bots.leonorekingdom.xyz`.
- `/healthz` returned 200 with `{"status":"healthy"}`.
- Logged-out `/api/v1/me` returned 401 with `AUTH_REQUIRED`.
- `/auth/discord` returned a 307 redirect using only `identify` and
  `guilds.members.read` and the exact production callback URI.
- Owner authorization returned to `/admin`; the overview identified Leonore as
  Guild owner and the configured guild as Leonore's Kingdom.
- The greeting scheduler remained disabled and the dashboard reported `0/0`
  schedules enabled.
- Member, outsider, CSRF, logout, role-revocation, and direct authenticated
  `/api/v1/me` checks remain part of manual UAT.

## 7. Backup and restore

Supabase Free does not satisfy the PRD backup requirement by itself. Choose an
encrypted destination outside Supabase and retain at least seven daily logical
backups. Never commit a dump.

Backup example (run from a secured operator environment):

```powershell
pg_dump --format=custom --no-owner --no-privileges "$env:LEONE_DIRECT_DATABASE_URL" --file leone-YYYYMMDD.dump
```

Restore rehearsal into an isolated database:

```powershell
createdb leone_restore_test
pg_restore --clean --if-exists --no-owner --no-privileges --dbname leone_restore_test leone-YYYYMMDD.dump
```

Run migrations, row-count reconciliation, the automated tests, and family-tree
privacy queries against the isolated restore. A backup is not accepted until a
restore rehearsal succeeds.

## 8. Rollback

Application rollback:

1. Disable/unschedule greetings dispatch if delivery is implicated.
2. In Vercel, promote the previous known-good production deployment.
3. Verify `/healthz`, `/ping`, signature rejection, and database access.
4. Do not reverse a compatible additive migration during an application rollback.

Database rollback:

- Use expand/migrate/contract across releases.
- If an import fails, roll back its transaction and retain the source JSON.
- For destructive corruption, stop writes, restore the verified encrypted backup
  to an isolated target, validate, then perform a controlled cutover.

DNS rollback is normally unnecessary because Vercel aliases are atomic. If the
custom domain itself is implicated, remove only the exact `bots` CNAME after
confirming the target; do not change the apex domain or unrelated records.

## 9. Post-deploy verification

```text
GET  https://bots.leonorekingdom.xyz/healthz                  -> 200 healthy
GET  https://bots.leonorekingdom.xyz/                         -> 200 SPA
GET  https://bots.leonorekingdom.xyz/api/discord/interactions -> Express 404 (POST-only)
POST /api/discord/interactions with invalid signature         -> 401
GET  /api/v1/me before OAuth configuration                    -> 404 by design
GET  /api/v1/me after OAuth configuration, logged out         -> 401
```

Review Vercel runtime logs for 5xx errors, signature failures outside the
expected Discord verification probe, OAuth failures, database timeouts, and
duplicate greeting run keys. Logs must not contain tokens, secrets, raw OAuth
responses, or relationship labels.
