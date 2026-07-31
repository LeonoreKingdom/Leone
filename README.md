# Leone

LeonoreKingdom Discord Bots Official.

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

Only one TMDB credential is required. Leone prefers
`TMDB_READ_ACCESS_TOKEN` when both are present. Keep either credential in
`.env`; never commit or paste it into Discord.

The TMDB developer API is used only for non-commercial movie discovery.
`/about` contains the required TMDB credit and notice. If Leone becomes a
commercial product, obtain an appropriate TMDB commercial license before
continuing to use TMDB data.

Deploy the updated Discord command after configuring the credential:

```powershell
npm.cmd run deploy:commands
```

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
