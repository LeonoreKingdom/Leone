require('dotenv').config();

const { copyFile, readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { createPool } = require('../src/db/pool');
const { validateState } = (() => {
  const validateState = (state) => {
    if (!state || state.version !== 1 || !state.members || !Array.isArray(state.requests) || !Array.isArray(state.edges)) throw new Error('Invalid Bonds JSON shape.');
    return state;
  };
  return { validateState };
})();

const sourcePath = path.resolve(process.argv.find((item) => item.startsWith('--file='))?.slice(7) ?? process.env.BONDS_DATA_FILE ?? 'data/bonds.json');
const apply = process.argv.includes('--apply');
const snowflake = /^\d+$/;

function checksum(contents) { return createHash('sha256').update(contents).digest('hex'); }
function splitMemberKey(key) {
  const separator = key.indexOf(':');
  return [key.slice(0, separator), key.slice(separator + 1)];
}

async function main() {
  const contents = await readFile(sourcePath, 'utf8');
  const state = validateState(JSON.parse(contents));
  const issues = [];
  const guildIds = new Set();
  for (const key of Object.keys(state.members)) {
    const [guildId, userId] = splitMemberKey(key);
    if (!snowflake.test(guildId) || !snowflake.test(userId)) issues.push(`Invalid member key: ${key}`);
    guildIds.add(guildId);
  }
  for (const item of [...state.requests, ...state.edges]) {
    guildIds.add(item.guildId);
    for (const field of ['guildId', 'fromId', 'toId']) if (!snowflake.test(item[field])) issues.push(`Invalid ${field} on ${item.id}`);
  }
  if (guildIds.size !== 1) issues.push(`Expected one guild, found ${guildIds.size}.`);
  const report = {
    source: sourcePath,
    checksum: checksum(contents),
    dryRun: !apply,
    counts: { profiles: Object.keys(state.members).length, requests: state.requests.length, edges: state.edges.length },
    issues,
  };
  if (issues.length || !apply) { console.log(JSON.stringify(report, null, 2)); if (issues.length) process.exitCode = 1; return; }

  const guildId = [...guildIds][0];
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('leone:bonds-import'))");
    const prior = await client.query('select id from data_imports where guild_id=$1 and source_name=$2 and source_checksum=$3', [guildId, path.basename(sourcePath), report.checksum]);
    if (prior.rowCount) { await client.query('rollback'); console.log(JSON.stringify({ ...report, alreadyImported: true }, null, 2)); return; }
    await client.query('insert into guilds (id,name) values ($1,$1) on conflict (id) do nothing', [guildId]);
    for (const [key, profile] of Object.entries(state.members)) {
      const [profileGuildId, userId] = splitMemberKey(key);
      await client.query('insert into member_privacy (guild_id,user_id,visibility) values ($1,$2,$3) on conflict (guild_id,user_id) do update set visibility=excluded.visibility,updated_at=now()', [profileGuildId, userId, profile.visibility ?? 'private']);
      for (const blockedId of profile.blockedUserIds ?? []) await client.query('insert into bond_blocks (guild_id,blocker_user_id,blocked_user_id) values ($1,$2,$3) on conflict do nothing', [profileGuildId, userId, blockedId]);
    }
    for (const request of state.requests.filter((item) => item.expiresAt > Date.now())) await client.query(`insert into bond_requests (id,guild_id,requester_user_id,target_user_id,requested_type,relationship_type,from_user_id,to_user_id,created_at,expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing`, [request.id, request.guildId, request.requesterId, request.targetId, request.requestedType, request.type, request.fromId, request.toId, new Date(request.createdAt), new Date(request.expiresAt)]);
    for (const edge of state.edges) await client.query(`insert into bonds (id,guild_id,relationship_type,from_user_id,to_user_id,created_at) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`, [edge.id, edge.guildId, edge.type, edge.fromId, edge.toId, new Date(edge.createdAt)]);
    await client.query('insert into data_imports (guild_id,source_name,source_checksum,counts) values ($1,$2,$3,$4::jsonb)', [guildId, path.basename(sourcePath), report.checksum, JSON.stringify(report.counts)]);
    await client.query('commit');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${sourcePath}.${stamp}.migration-backup`;
    await copyFile(sourcePath, backupPath);
    console.log(JSON.stringify({ ...report, imported: true, backupPath }, null, 2));
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
