# Leone

LeonoreKingdom Discord Bots Official.

Product requirements and the planned database, dashboard, family-tree,
Greetings, and deployment architecture are documented in
[`docs/PRD.md`](docs/PRD.md).

## Development

```powershell
npm.cmd test
npm.cmd run deploy:commands
npm.cmd start
```

Required environment variables:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`

Optional environment variables:

- `LEANNE_USER_ID` — overrides the configured Leanne account ID.
- `BONDS_DATA_FILE` — overrides the default `data/bonds.json` path.
- `TMDB_READ_ACCESS_TOKEN` — recommended TMDB application credential
  for `/recommend movie`.
- `TMDB_API_KEY` — supported alternative when a Read Access Token is
  not configured.
- `BMKG_ADM4` — default Indonesian administrative level IV code used
  by the manual `/morning` greeting, for example `31.71.03.1001`.
- `MORNING_LOCATION` — optional display label that overrides the
  location name returned by BMKG.
- `SERVER_STATS_API_KEY` — optional 16+ character key for the read-only
  live statistics endpoint. Keep it server-side and share it only with the
  website's server-side route.
- `STATS_FEATURED_USER_IDS` — optional comma-separated Discord user IDs to
  include as public profile cards (the guild owner, Leanne, and Leone are
  included automatically when available).
- `STATS_CITIZEN_ROLE_NAME`, `STATS_ADMIN_ROLE_NAME`, and
  `STATS_MODERATOR_ROLE_NAME` — role names used for the Citizen count and
  public Admin/Moderator profile selection; they default to `Citizen`,
  `Admin`, and `Moderator`.
- `STATS_ROLE_PROFILE_LIMIT` — maximum profiles selected per staff role,
  from 1 to 5; defaults to `2`.
- `STATS_CACHE_TTL_SECONDS` — live statistics cache lifetime from 5 to 300
  seconds; defaults to 30.

Only one TMDB credential is required. Leone prefers
`TMDB_READ_ACCESS_TOKEN` when both are present. Keep either credential in
`.env`; never commit or paste it into Discord.

The TMDB developer API is used only for non-commercial movie discovery.
`/about` contains the required TMDB credit and notice. If Leone becomes a
commercial product, obtain an appropriate TMDB commercial license before
continuing to use TMDB data.

AniList powers `/anime`, `/novel`, `/manga`, `/manhwa`, and `/manhua` public
metadata searches without an application key. TMDB powers `/series` using the
same credential as movie discovery.

Deploy the updated Discord command after configuring the credential:

```powershell
npm.cmd run deploy:commands
```

## Live server statistics

Leone's `/server-stats` command and the admin **Live Server Stats** page read
current aggregate counts from Discord. The read-only website integration
endpoint is `GET /api/server-stats` (also available at
`/api/v1/public/server-stats`). It returns `Total Members`, `Citizen`,
`Online`, `In Voice`, `Bots`, the guild name and icon, plus selected public
Discord profile URLs. Profiles selected from the configured Admin and
Moderator roles include their role label. No bot token is included. When
`SERVER_STATS_API_KEY` is set, send it from a server-side caller using
`x-leone-stats-key` or `Authorization: Bearer ...`; never expose it in browser
code.

`In Voice` and the complete presence-based `Online` count are produced by the
optional Render Gateway snapshot worker. To activate that path, first apply
`supabase/migrations/202609010001_server_stats_snapshots.sql`, enable the
`GUILD_MEMBERS` and `GUILD_PRESENCES` privileged intents in the Discord
Developer Portal, then set `SERVER_STATS_GATEWAY_ENABLED=true` on the Render
worker. `GUILD_VOICE_STATES` is requested automatically with that setting. The
worker refreshes the snapshot every `STATS_GATEWAY_SNAPSHOT_INTERVAL_SECONDS`
seconds; until it is enabled, unavailable fields are returned as `null` rather
than guessed.

## Manual morning greeting

The staff-only `/morning` command does not run on a schedule:

- `/morning preview role:@Citizen` privately renders the greeting and
  never notifies the role.
- `/morning send role:@Citizen` posts in the current channel and
  notifies only the selected role.
- `adm4` and `location` can be supplied per command, overriding the
  optional environment defaults.

Leone uses BMKG's public forecast API when an ADM4 code is available
and clearly attributes the weather data. If the location is missing or
BMKG is unavailable, Leone posts a weather-neutral greeting instead.

For a role notification, the selected role must be mentionable or
Leone must have `Mention Everyone` in the target channel. Prefer a
dedicated opt-in morning role instead of notifying every Citizen.

## Leone Bonds data policy

`/bonds` is private by default and uses reciprocal acceptance. Social
bonds never grant Discord roles or permissions.

- Pending requests expire after seven days.
- Declined requests are deleted immediately.
- Accepted bonds remain until unlink, block, or data deletion.
- `/bonds export` returns the invoking member's server-scoped data.
- `/bonds delete-data confirm:true` permanently removes that member's
  profile, requests, bonds, and references from block lists.
- Bonds keeps no deleted-relationship history.
- A third party can see a relationship only when both participants'
  privacy settings allow it.

The default JSON store uses serialized atomic writes and is intended for
one Leone process. Keep `data/` out of Git. Replace the store with a
transactional database before running multiple bot instances or treating
Bonds as production-ready.
