require('dotenv').config();

const http = require('node:http');
const { Client, Events, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const { getConfig, requireConfig } = require('./config');
const { getPool, closePool } = require('./db/pool');
const { createGroqClient } = require('./features/chatbot/groq-client');
const { createChatbotService, isBlockedChannel } = require('./features/chatbot/chatbot-service');
const { KnowledgeRepository } = require('./features/chatbot/knowledge-repository');
const { redactText } = require('./features/chatbot/redaction');

const config = getConfig();
requireConfig('DISCORD_TOKEN', 'DATABASE_URL');
const pool = getPool();
const repository = new KnowledgeRepository(pool);
const groqClient = createGroqClient({ config });
const chatbot = createChatbotService({ config, repository, groqClient });
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

let discordReady = false;
const httpPort = Number(process.env.PORT || 3000);
const httpServer = http.createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/healthz', '/wake'].includes(request.url)) {
    response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ status: 'ok', discordReady, service: 'leone-chat-worker', timestamp: new Date().toISOString() }));
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

client.once(Events.ClientReady, (readyClient) => {
  discordReady = true;
  console.log(`Leone chatbot worker logged in as ${readyClient.user.tag}`);
  repository.touchWorker(config.DISCORD_GUILD_ID).catch((error) => console.error('chatbot.worker_heartbeat_failed', error));
  setInterval(() => repository.touchWorker(config.DISCORD_GUILD_ID).catch((error) => console.error('chatbot.worker_heartbeat_failed', error)), 60_000).unref();
  readyClient.user.setPresence({ activities: [{ name: 'the Kingdom', type: ActivityType.Listening }], status: 'online' });
});

client.on(Events.MessageCreate, (message) => enqueue(async () => {
  if (!message || message.author?.bot || message.webhookId) return;
  const guildId = message.guildId ?? config.DISCORD_GUILD_ID;
  const settings = await repository.getSettings(guildId, { cooldown: config.CHATBOT_PER_USER_COOLDOWN_SECONDS, dailyLimit: config.CHATBOT_DAILY_REQUEST_LIMIT, model: config.GROQ_MODEL });
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
