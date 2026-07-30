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
