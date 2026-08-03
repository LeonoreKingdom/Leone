require('dotenv').config();

const { existsSync } = require('node:fs');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { verifyKey, InteractionResponseType } = require('discord-interactions');
const { InteractionType, MessageFlags } = require('discord.js');
const { ZodError } = require('zod');

const { createHttpInteraction } = require('./src/adapters/discord/http-interaction');
const { DiscordRestClient } = require('./src/adapters/discord/rest-client');
const { executeCommand } = require('./src/commands/registry');
const { getConfig } = require('./src/config');
const { AuditRepository } = require('./src/db/audit-repository');
const { checkDatabase, getPool } = require('./src/db/pool');
const { dispatchDueGreetings } = require('./src/features/automation/greetings/dispatcher');
const { GreetingRepository } = require('./src/features/automation/greetings/greeting-repository');
const { executeComponent } = require('./src/interactions/component-registry');
const { createLogger } = require('./src/shared/logger');
const { createApiRouter } = require('./src/web/api');
const { createAuthMiddleware, createAuthRouter } = require('./src/web/auth');
const { SessionRepository } = require('./src/web/session-repository');

function safeEqual(left, right) {
  const first = Buffer.from(left ?? '');
  const second = Buffer.from(right ?? '');
  return first.length === second.length && timingSafeEqual(first, second);
}

function createApp(overrides = {}) {
  const config = overrides.config ?? getConfig();
  const logger = overrides.logger ?? createLogger({ level: config.LOG_LEVEL });
  const pool = overrides.pool ?? (config.DATABASE_URL ? getPool() : null);
  const restClient = overrides.restClient ?? (config.DISCORD_TOKEN
    ? new DiscordRestClient({ token: config.DISCORD_TOKEN, applicationId: config.DISCORD_CLIENT_ID })
    : null);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((request, response, next) => {
    request.correlationId = request.get('x-request-id') ?? randomUUID();
    response.setHeader('x-request-id', request.correlationId);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
      },
    },
  }));

  app.get(['/healthz', '/api/healthz'], async (request, response) => {
    let healthy = Boolean(pool && restClient);
    if (pool) {
      try { await checkDatabase(pool); } catch { healthy = false; }
    }
    response.status(healthy ? 200 : 503).json({ status: healthy ? 'healthy' : 'unhealthy' });
  });

  app.post('/api/discord/interactions', express.raw({ type: 'application/json', limit: '1mb' }), async (request, response) => {
    const signature = request.get('x-signature-ed25519');
    const timestamp = request.get('x-signature-timestamp');
    const age = Math.abs(Date.now() - Number(timestamp) * 1000);
    let signatureValid = false;
    if (config.DISCORD_PUBLIC_KEY && signature && timestamp && age <= 5 * 60 * 1000) {
      try {
        signatureValid = await verifyKey(request.body, signature, timestamp, config.DISCORD_PUBLIC_KEY);
      } catch {
        signatureValid = false;
      }
    }
    if (!signatureValid) {
      logger.warn('discord.interaction_signature_rejected', { correlationId: request.correlationId });
      response.status(401).json({ error: 'INVALID_SIGNATURE' });
      return;
    }

    let payload;
    try { payload = JSON.parse(request.body.toString('utf8')); } catch { response.status(400).json({ error: 'INVALID_JSON' }); return; }
    if (payload.type === InteractionType.Ping) {
      response.json({ type: InteractionResponseType.PONG });
      return;
    }
    if (!restClient) { response.status(503).json({ error: 'DISCORD_NOT_CONFIGURED' }); return; }

    const isButton = payload.type === InteractionType.MessageComponent;
    const isCommand = payload.type === InteractionType.ApplicationCommand;
    if (!isButton && !isCommand) { response.status(400).json({ error: 'UNSUPPORTED_INTERACTION' }); return; }
    const ephemeral = isCommand && ['bonds', 'greetings'].includes(payload.data?.name);
    response.json(isButton
      ? { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE }
      : { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: ephemeral ? { flags: MessageFlags.Ephemeral } : {} });

    try {
      const interaction = await createHttpInteraction({ payload, response, restClient, preDeferred: true });
      if (isCommand) await executeCommand(interaction);
      else if (!(await executeComponent(interaction))) throw new Error(`Unsupported component: ${interaction.customId}`);
      logger.info('discord.interaction_completed', { correlationId: request.correlationId, command: payload.data?.name ?? 'component' });
    } catch (error) {
      logger.error('discord.interaction_failed', { correlationId: request.correlationId, command: payload.data?.name, error });
      try {
        await restClient.editInteractionReply(payload.application_id, payload.token, {
          content: 'Leone encountered an error while processing this interaction.',
          flags: MessageFlags.Ephemeral,
          allowed_mentions: { parse: [] },
        });
      } catch (responseError) {
        logger.error('discord.interaction_error_response_failed', { correlationId: request.correlationId, error: responseError });
      }
    }
  });

  app.use(express.json({ limit: '256kb' }));

  if (pool && restClient && config.SESSION_SECRET && config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET && config.DISCORD_GUILD_ID) {
    const sessions = overrides.sessionRepository ?? new SessionRepository(pool, { ttlHours: config.SESSION_TTL_HOURS });
    const audit = new AuditRepository(pool);
    const authenticate = createAuthMiddleware({ config, sessionRepository: sessions, restClient, pool });
    const authRouter = createAuthRouter({ express, config, sessionRepository: sessions, pool, restClient, auditRepository: audit });
    app.use('/auth', authRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/v1', createApiRouter({ express, config, pool, restClient, sessionRepository: sessions, authenticate, bondStore: overrides.bondStore, bmkgClient: overrides.bmkgClient }));
  }

  app.post('/api/internal/greetings/dispatch', async (request, response) => {
    if (!config.SCHEDULER_SECRET || !safeEqual(request.get('authorization'), `Bearer ${config.SCHEDULER_SECRET}`)) {
      response.status(401).json({ error: 'SCHEDULER_AUTH_REQUIRED' });
      return;
    }
    if (!pool || !restClient) { response.status(503).json({ error: 'SERVICE_NOT_CONFIGURED' }); return; }
    const result = await dispatchDueGreetings({
      repository: new GreetingRepository(pool),
      auditRepository: new AuditRepository(pool),
      restClient,
      enabled: config.greetingsSchedulerEnabled,
    });
    response.json(result);
  });

  const publicDir = path.join(__dirname, 'public');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
    app.get(['/admin', '/admin/*path', '/family', '/family/*path'], (request, response) => response.sendFile(path.join(publicDir, 'index.html')));
  }

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error instanceof ZodError ? 400 : error.code === 'PRIVATE_TREE' ? 403 : 500;
    logger.error('http.request_failed', { correlationId: request.correlationId, status, error });
    response.status(status).json({
      error: error instanceof ZodError ? 'VALIDATION_FAILED' : error.code ?? 'INTERNAL_ERROR',
      message: status === 500 ? 'Leone could not complete this request.' : error.message,
      details: error instanceof ZodError ? error.issues : undefined,
    });
  });

  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
module.exports.safeEqual = safeEqual;
