require('dotenv').config();

const http = require('node:http');
const { Client, Events, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const { getConfig, requireConfig } = require('./config');
const { getPool, closePool } = require('./db/pool');
const { createGroqClient } = require('./features/chatbot/groq-client');
const { createGeminiClient } = require('./features/chatbot/gemini-client');
const { createChatbotService, isBlockedChannel } = require('./features/chatbot/chatbot-service');
const { KnowledgeRepository } = require('./features/chatbot/knowledge-repository');
const { reindexCanonical } = require('./features/chatbot/knowledge-indexer');
const { redactText } = require('./features/chatbot/redaction');
const { buildServerStatsFromGatewayGuild } = require('./features/kingdom/server-stats/service');
const { ServerStatsSnapshotRepository } = require('./features/kingdom/server-stats/snapshot-repository');
const { DiscordRestClient } = require('./adapters/discord/rest-client');

const config = getConfig();
requireConfig('DISCORD_TOKEN', 'DATABASE_URL');
const pool = getPool();
const repository = new KnowledgeRepository(pool);
const discordRestClient = new DiscordRestClient({ token: config.DISCORD_TOKEN });
const llmClient = config.LLM_PROVIDER === 'gemini' ? createGeminiClient({ config }) : createGroqClient({ config });
const chatbot = createChatbotService({ config, repository, llmClient });
const statsSnapshotRepository = config.serverStatsGatewayEnabled
  ? new ServerStatsSnapshotRepository(pool)
  : null;
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.MessageContent,
];
if (config.serverStatsGatewayEnabled) {
  intents.push(
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
  );
}
const client = new Client({
  intents,
  partials: [Partials.Channel],
});

let discordReady = false;
let statsMembersLoaded = false;
let statsRefreshTimer = null;
let statsRefreshInterval = null;
let statsRefreshInFlight = null;
const httpPort = Number(process.env.PORT || 3000);
const httpServer = http.createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/healthz', '/wake'].includes(request.url)) {
    response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  const llmReady = config.LLM_PROVIDER === 'gemini' ? Boolean(config.GEMINI_API_KEY) : Boolean(config.GROQ_API_KEY);
  const llmModel = config.LLM_PROVIDER === 'gemini' ? config.GEMINI_MODEL : config.GROQ_MODEL;
  response.end(JSON.stringify({ status: 'ok', discordReady, llmProvider: config.LLM_PROVIDER, llmReady, llmModel, service: 'leone-chat-worker', timestamp: new Date().toISOString() }));
});
httpServer.listen(httpPort, '0.0.0.0', () => console.log(`Leone chatbot health endpoint listening on ${httpPort}`));

let active = true;
let inFlight = 0;
const pending = [];

function enqueue(task) {
  pending.push(task);
  drain();
}

function drain() {
  while (active && inFlight < 4 && pending.length) {
    inFlight += 1;
    const task = pending.shift();
    Promise.resolve()
      .then(() => task())
      .catch((error) => console.error('chatbot.worker_task_failed', error))
      .finally(() => { inFlight -= 1; drain(); });
  }
}

async function refreshStatsSnapshot() {
  if (!statsSnapshotRepository || !discordReady || statsRefreshInFlight) return statsRefreshInFlight;

  statsRefreshInFlight = (async () => {
    const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID)
      ?? await client.guilds.fetch(config.DISCORD_GUILD_ID);
    if (!guild) throw new Error(`Guild ${config.DISCORD_GUILD_ID} is not available in the Gateway cache.`);
    if (!statsMembersLoaded) {
      await guild.members.fetch();
      statsMembersLoaded = true;
    }
    const snapshot = buildServerStatsFromGatewayGuild({
      guild,
      botUser: client.user,
      config,
      membersComplete: statsMembersLoaded,
    });
    await statsSnapshotRepository.upsert(snapshot);
  })()
    .catch((error) => console.error('server_stats_snapshot_failed', error))
    .finally(() => { statsRefreshInFlight = null; });

  return statsRefreshInFlight;
}

function scheduleStatsSnapshot(delayMs = 1_000) {
  if (!statsSnapshotRepository) return;
  if (statsRefreshTimer) clearTimeout(statsRefreshTimer);
  statsRefreshTimer = setTimeout(() => {
    statsRefreshTimer = null;
    void refreshStatsSnapshot();
  }, delayMs);
  statsRefreshTimer.unref?.();
}

async function ensureCanonicalKnowledge() {
  const settings = await repository.getSettings(config.DISCORD_GUILD_ID, {
    cooldown: config.CHATBOT_PER_USER_COOLDOWN_SECONDS,
    dailyLimit: config.CHATBOT_DAILY_REQUEST_LIMIT,
    model: config.LLM_PROVIDER === 'gemini' ? config.GEMINI_MODEL : config.GROQ_MODEL,
  });
  if (!settings.enabled) return;

  const status = await repository.status(config.DISCORD_GUILD_ID);
  if (Number(status.documents) > 0 && Number(status.canonical_chunks) > 0) return;

  const result = await reindexCanonical({
    guildId: config.DISCORD_GUILD_ID,
    restClient: discordRestClient,
    repository,
  });
  console.log('chatbot.canonical_reindex_succeeded', result);
}

client.once(Events.ClientReady, (readyClient) => {
  discordReady = true;
  console.log(`Leone chatbot worker logged in as ${readyClient.user.tag}`);
  repository.touchWorker(config.DISCORD_GUILD_ID).catch((error) => console.error('chatbot.worker_heartbeat_failed', error));
  ensureCanonicalKnowledge().catch((error) => console.error('chatbot.canonical_reindex_failed', error));
  setInterval(() => repository.touchWorker(config.DISCORD_GUILD_ID).catch((error) => console.error('chatbot.worker_heartbeat_failed', error)), 60_000).unref();
  readyClient.user.setPresence({ activities: [{ name: 'the Kingdom', type: ActivityType.Listening }], status: 'online' });
  if (statsSnapshotRepository) {
    scheduleStatsSnapshot(0);
    statsRefreshInterval = setInterval(() => scheduleStatsSnapshot(0), config.STATS_GATEWAY_SNAPSHOT_INTERVAL_SECONDS * 1_000);
    statsRefreshInterval.unref?.();
  }
});

for (const event of [Events.VoiceStateUpdate, Events.PresenceUpdate, Events.GuildMemberAdd, Events.GuildMemberRemove, Events.GuildMemberUpdate, Events.GuildRoleCreate, Events.GuildRoleDelete, Events.GuildRoleUpdate]) {
  client.on(event, () => scheduleStatsSnapshot());
}

client.on(Events.MessageCreate, (message) => enqueue(async () => {
  if (!message || message.author?.bot || message.webhookId) return;
  const guildId = message.guildId ?? config.DISCORD_GUILD_ID;
  const defaultModel = config.LLM_PROVIDER === 'gemini' ? config.GEMINI_MODEL : config.GROQ_MODEL;
  const settings = await repository.getSettings(guildId, { cooldown: config.CHATBOT_PER_USER_COOLDOWN_SECONDS, dailyLimit: config.CHATBOT_DAILY_REQUEST_LIMIT, model: defaultModel });
  if (!settings.enabled) return;
  if (message.guildId && settings.channel_ids?.includes(message.channelId) && !message.channel?.isThread?.() && !isBlockedChannel(message)) {
    const text = redactText(message.content, { maxLength: 4000 });
    if (text) await repository.ingestMessage({ guildId, channelId: message.channelId, messageId: message.id, content: text, retentionDays: settings.retention_days });
  }
  await chatbot.handleMessage(message, { botUserId: client.user?.id });
}));

client.on(Events.Error, (error) => console.error('chatbot.discord_error', error));
client.on(Events.Warn, (warning) => console.warn('chatbot.discord_warning', warning));

async function shutdown(signal) {
  if (!active) return;
  active = false;
  pending.length = 0;
  if (statsRefreshTimer) clearTimeout(statsRefreshTimer);
  if (statsRefreshInterval) clearInterval(statsRefreshInterval);
  discordReady = false;
  client.destroy();
  await new Promise((resolve) => httpServer.close(resolve));
  await closePool().catch(() => {});
  console.log(`Leone chatbot worker stopped (${signal})`);
  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
client.login(config.DISCORD_TOKEN).catch((error) => { console.error('chatbot.login_failed', error); process.exitCode = 1; });

module.exports = { client, enqueue, drain };
