require('dotenv').config();

const { DiscordRestClient } = require('../src/adapters/discord/rest-client');
const { requireConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');

async function main() {
  const config = requireConfig('DATABASE_URL', 'DISCORD_TOKEN', 'DISCORD_GUILD_ID');
  const rest = new DiscordRestClient({ token: config.DISCORD_TOKEN, applicationId: config.DISCORD_CLIENT_ID });
  const bundle = await rest.getGuildBundle(config.DISCORD_GUILD_ID, { refresh: true });
  const pool = createPool(config.DATABASE_URL);
  await pool.query(`insert into guilds (id,name,owner_user_id) values ($1,$2,$3) on conflict (id) do update set name=excluded.name,owner_user_id=excluded.owner_user_id,updated_at=now()`, [bundle.guild.id, bundle.guild.name, bundle.guild.owner_id]);
  console.log(`Seeded ${bundle.guild.name} (${bundle.guild.id}) with live owner ID.`);
  await pool.end();
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
