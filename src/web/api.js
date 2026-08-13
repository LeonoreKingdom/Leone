const { serialize } = require('cookie');
const { z } = require('zod');

const { AuditRepository } = require('../db/audit-repository');
const { AdminRepository } = require('../db/admin-repository');
const { checkDatabase } = require('../db/pool');
const { createBmkgClient } = require('../features/automation/morning/bmkg-client');
const { buildGreetingMessage } = require('../features/automation/greetings/greeting-message');
const { GreetingRepository } = require('../features/automation/greetings/greeting-repository');
const { KnowledgeRepository } = require('../features/chatbot/knowledge-repository');
const { reindexCanonical } = require('../features/chatbot/knowledge-indexer');
const { isPublicChannel } = require('../features/chatbot/knowledge-indexer');
const { BondService } = require('../features/relationships/bond-service');
const { createDefaultBondStore } = require('../features/relationships/bond-store');
const { FamilyTreeService } = require('../features/relationships/family-service');
const {
  archiveChannel,
  createChannel,
  createRole,
  executeRoleOperation,
  previewRoleOperation,
  serverReadiness,
  updateChannel,
  updateRole,
} = require('../features/admin/server-admin-service');
const { executeModeration, validateModerationInput } = require('../features/admin/moderation-service');
const {
  CSRF_COOKIE,
  SESSION_COOKIE,
  ALL_CAPABILITIES,
  cookieOptions,
  requireCapability,
  requireCsrf,
} = require('./auth');

const snowflake = z.string().regex(/^\d+$/);
const uuid = z.string().uuid();
const capabilityEnum = z.enum(ALL_CAPABILITIES);

function requireModerationCapability(request, response, next) {
  const action = request.body?.action;
  const capability = {
    warn: 'moderation.warn',
    timeout: 'moderation.timeout',
    untimeout: 'moderation.timeout',
    kick: 'moderation.kick',
    ban: 'moderation.ban',
    unban: 'moderation.ban',
    purge: 'moderation.messages',
  }[action];
  if (!capability || !request.auth?.capabilities.has(capability)) {
    response.status(403).json({ error: 'CAPABILITY_REQUIRED', capability: capability ?? 'moderation.read' });
    return;
  }
  next();
}

function serializeDiscordMember(member) {
  return {
    id: member.user?.id,
    username: member.user?.username ?? null,
    displayName: member.user?.global_name ?? member.user?.username ?? member.user?.id,
    roles: member.roles ?? [],
    joinedAt: member.joined_at ?? null,
  };
}

async function getGuildSettings(pool, guildId) {
  const { rows } = await pool.query('select settings from guilds where id = $1', [guildId]);
  return rows[0]?.settings ?? {};
}

const scheduleSchema = z.object({
  name: z.string().min(1).max(80),
  channelId: snowflake,
  roleId: snowflake,
  occasion: z.enum(['morning', 'afternoon', 'evening', 'night', 'custom']),
  timezone: z.string().min(1).max(64).default('Asia/Jakarta'),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  adm4: z.string().max(20).nullable().optional(),
  locationLabel: z.string().max(100).nullable().optional(),
  graceMinutes: z.number().int().min(0).max(120).default(15),
});

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function parseTypes(value) {
  if (!value) return null;
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function createApiRouter({
  express,
  config,
  pool,
  restClient,
  sessionRepository,
  authenticate,
  bondStore = createDefaultBondStore(),
  bmkgClient = createBmkgClient(),
}) {
  const router = express.Router();
  const audit = new AuditRepository(pool);
  const admin = new AdminRepository(pool);
  const greetings = new GreetingRepository(pool);
  const knowledge = new KnowledgeRepository(pool);
  const bonds = new BondService({ store: bondStore });
  const family = new FamilyTreeService({ store: bondStore });
  const csrf = requireCsrf(sessionRepository);

  router.use(authenticate);

  router.get('/me', (request, response) => {
    const user = request.auth.user;
    response.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.global_name ?? user.username,
        avatar: user.avatar ?? null,
      },
      guild: { id: request.auth.guild.id, name: request.auth.guild.name },
      capabilities: [...request.auth.capabilities].sort(),
      owner: request.auth.guild.owner_id === request.auth.userId,
    });
  });

  router.post('/logout', csrf, asyncRoute(async (request, response) => {
    await sessionRepository.delete(request.auth.rawSessionToken);
    response.setHeader('Set-Cookie', [
      serialize(SESSION_COOKIE, '', { ...cookieOptions(config, new Date(0)), maxAge: 0 }),
      serialize(CSRF_COOKIE, '', { ...cookieOptions(config, new Date(0)), httpOnly: false, maxAge: 0 }),
    ]);
    response.status(204).end();
  }));

  router.get('/family/:memberId', asyncRoute(async (request, response) => {
    const memberId = snowflake.parse(request.params.memberId);
    const graph = await family.getGraph({
      guildId: request.auth.guildId,
      viewerId: request.auth.userId,
      memberId,
      depth: request.query.depth,
      types: parseTypes(request.query.types),
    });
    const nodes = await Promise.all(graph.nodeIds.map(async (id) => {
      try {
        const user = await restClient.getUser(id);
        return { id, label: user.global_name ?? user.username, avatar: user.avatar ?? null };
      } catch {
        return { id, label: `Discord user ${id}`, avatar: null };
      }
    }));
    response.json({ ...graph, nodes });
  }));

  router.get('/bonds/export', asyncRoute(async (request, response) => {
    response.setHeader('Content-Disposition', 'attachment; filename="leone-bonds-export.json"');
    response.json(await bonds.exportUserData({ guildId: request.auth.guildId, userId: request.auth.userId }));
  }));

  router.delete('/bonds/me', csrf, asyncRoute(async (request, response) => {
    const result = await bonds.eraseUserData({ guildId: request.auth.guildId, userId: request.auth.userId });
    await audit.record({
      guildId: request.auth.guildId,
      actorUserId: request.auth.userId,
      action: 'bonds.self_delete',
      targetCategory: 'member',
      targetId: request.auth.userId,
      metadata: result,
    });
    response.json(result);
  }));

  router.get('/admin/overview', requireCapability('admin.read'), asyncRoute(async (request, response) => {
    const [database, schedules, recentRuns] = await Promise.all([
      checkDatabase(pool),
      greetings.listSchedules(request.auth.guildId),
      greetings.listRuns(request.auth.guildId, 10),
    ]);
    response.json({
      status: 'ok',
      database,
      discord: { guildId: request.auth.guildId, name: request.auth.guild.name },
      schedules: { total: schedules.length, enabled: schedules.filter((item) => item.enabled).length },
      recentRuns,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.npm_package_version ?? 'development',
    });
  }));

  router.get('/admin/config', requireCapability('admin.read'), asyncRoute(async (request, response) => {
    const [guildResult, mappingResult, bundle] = await Promise.all([
      pool.query('select scheduler_enabled, settings from guilds where id = $1', [request.auth.guildId]),
      pool.query('select role_id, capability from guild_capability_roles where guild_id = $1 order by capability, role_id', [request.auth.guildId]),
      restClient.getGuildBundle(request.auth.guildId, { refresh: true }),
    ]);
    response.json({
      ...guildResult.rows[0],
      capabilityRoles: mappingResult.rows,
      discordOptions: {
        roles: bundle.roles.filter((role) => role.id !== request.auth.guildId).map((role) => ({ id: role.id, name: role.name, color: role.color, position: role.position, managed: Boolean(role.managed) })),
        channels: bundle.channels.map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parent_id ?? null })),
      },
    });
  }));

  router.patch('/admin/config', requireCapability('config.write'), csrf, asyncRoute(async (request, response) => {
    const schema = z.object({
      schedulerEnabled: z.boolean().optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
      capabilityRoles: z.array(z.object({
        roleId: snowflake,
        capability: capabilityEnum,
      })).optional(),
    });
    const input = schema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update guilds set scheduler_enabled = coalesce($2, scheduler_enabled),
          settings = coalesce(settings, '{}'::jsonb) || coalesce($3::jsonb, '{}'::jsonb), updated_at = now() where id = $1`,
        [request.auth.guildId, input.schedulerEnabled, input.settings ? JSON.stringify(input.settings) : null],
      );
      if (input.capabilityRoles) {
        await client.query('delete from guild_capability_roles where guild_id = $1', [request.auth.guildId]);
        for (const mapping of input.capabilityRoles) {
          await client.query('insert into guild_capability_roles (guild_id, role_id, capability) values ($1,$2,$3)', [request.auth.guildId, mapping.roleId, mapping.capability]);
        }
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'config.update', targetCategory: 'guild' });
    response.json({ updated: true });
  }));

  router.get('/admin/moderation/summary', requireCapability('moderation.read'), asyncRoute(async (request, response) => {
    const [readiness, cases] = await Promise.all([
      serverReadiness({ guildId: request.auth.guildId, restClient }),
      admin.listCases({ guildId: request.auth.guildId, limit: 10 }),
    ]);
    response.json({ readiness, recentCases: cases });
  }));

  router.get('/admin/moderation/members', requireCapability('moderation.read'), asyncRoute(async (request, response) => {
    const query = String(request.query.query ?? '').trim();
    if (!query) return response.json([]);
    const members = await restClient.searchGuildMembers(request.auth.guildId, query, Math.min(Number(request.query.limit) || 25, 100));
    response.json(members.map(serializeDiscordMember));
  }));

  router.get('/admin/moderation/cases', requireCapability('moderation.read'), asyncRoute(async (request, response) => {
    const rows = await admin.listCases({ guildId: request.auth.guildId, limit: Number(request.query.limit) || 100, before: request.query.before ?? null, targetUserId: request.query.targetUserId ?? null });
    const ids = [...new Set(rows.flatMap((row) => [row.actor_user_id, row.target_user_id]).filter(Boolean))];
    const labels = new Map();
    await Promise.all(ids.map(async (id) => {
      try {
        const user = await restClient.getUser(id);
        labels.set(id, `@${user.global_name ?? user.username}`);
      } catch { labels.set(id, `<@${id}>`); }
    }));
    response.json(rows.map((row) => ({ ...row, actor: labels.get(row.actor_user_id), target: labels.get(row.target_user_id) })));
  }));

  router.post('/admin/moderation/actions', requireModerationCapability, csrf, asyncRoute(async (request, response) => {
    const input = z.object({
      action: z.enum(['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge']),
      targetUserId: snowflake.optional(),
      reason: z.string().trim().min(1).max(512),
      durationSeconds: z.number().int().positive().max(2419200).optional(),
      deleteMessageSeconds: z.number().int().min(0).max(604800).optional(),
      channelId: snowflake.optional(),
      messageCount: z.number().int().min(1).max(100).optional(),
      sendDm: z.boolean().default(false),
      confirm: z.literal(true),
      clientRequestId: uuid,
    }).parse(request.body);
    validateModerationInput(input);
    const existing = await admin.findOperationByRequest(request.auth.guildId, input.clientRequestId);
    if (existing) return response.json({ idempotent: true, operation: existing });
    const settings = await getGuildSettings(pool, request.auth.guildId);
    const operation = await admin.createOperation({
      guildId: request.auth.guildId,
      actorUserId: request.auth.userId,
      operationType: 'moderation',
      targetId: input.targetUserId ?? request.auth.userId,
      clientRequestId: input.clientRequestId,
      confirmationPhrase: 'CONFIRMED',
      payload: input,
    });
    try {
      const result = await executeModeration({ guildId: request.auth.guildId, actorUserId: request.auth.userId, restClient, repository: admin, audit, input, settings });
      await admin.completeOperation({ id: operation.id, result: 'success', metadata: { caseId: result.id } });
      response.status(201).json({ case: result, operationId: operation.id });
    } catch (error) {
      await admin.completeOperation({ id: operation.id, result: 'failed', errorCode: error.code ?? 'DISCORD_ACTION_FAILED', metadata: { message: error.message } });
      throw error;
    }
  }));

  router.get('/admin/chatbot/settings', requireCapability('chatbot.manage'), asyncRoute(async (request, response) => {
    const [settings, bundle] = await Promise.all([
      knowledge.getSettings(request.auth.guildId, { cooldown: config.CHATBOT_PER_USER_COOLDOWN_SECONDS, dailyLimit: config.CHATBOT_DAILY_REQUEST_LIMIT, model: config.GROQ_MODEL }),
      restClient.getGuildBundle(request.auth.guildId, { refresh: true }),
    ]);
    const parentNames = new Map(bundle.channels.filter((channel) => channel.type === 4).map((item) => [item.id, item.name]));
    response.json({
      settings: { ...settings, channelIds: settings.channel_ids ?? [], triggerMode: settings.trigger_mode, retentionDays: settings.retention_days, perUserCooldownSeconds: settings.per_user_cooldown_seconds, dailyRequestLimit: settings.daily_request_limit },
      channels: bundle.channels.filter((channel) => isPublicChannel(channel, parentNames)).map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parent_id ?? null })),
      readiness: { groq: Boolean(config.GROQ_API_KEY), gateway: Boolean(config.DISCORD_TOKEN), database: true },
    });
  }));

  router.patch('/admin/chatbot/settings', requireCapability('chatbot.manage'), csrf, asyncRoute(async (request, response) => {
    const current = await knowledge.getSettings(request.auth.guildId, { cooldown: config.CHATBOT_PER_USER_COOLDOWN_SECONDS, dailyLimit: config.CHATBOT_DAILY_REQUEST_LIMIT, model: config.GROQ_MODEL });
    const input = z.object({
      enabled: z.boolean().optional(),
      channelIds: z.array(snowflake).max(100).optional(),
      triggerMode: z.enum(['mention_dm', 'auto_response']).optional(),
      retentionDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
      perUserCooldownSeconds: z.number().int().min(0).max(3600).optional(),
      dailyRequestLimit: z.number().int().min(0).max(100000).optional(),
      model: z.string().trim().min(1).max(120).nullable().optional(),
    }).parse(request.body);
    const bundle = await restClient.getGuildBundle(request.auth.guildId, { refresh: true });
    const parentNames = new Map(bundle.channels.filter((channel) => channel.type === 4).map((channel) => [channel.id, channel.name]));
    const publicChannelIds = new Set(bundle.channels.filter((channel) => isPublicChannel(channel, parentNames)).map((channel) => channel.id));
    const nextChannelIds = input.channelIds ?? current.channel_ids ?? [];
    if (nextChannelIds.some((channelId) => !publicChannelIds.has(channelId))) throw new Error('Only owner-approved public channels can be selected for chatbot knowledge.');
    const removedChannelIds = (current.channel_ids ?? []).filter((channelId) => !nextChannelIds.includes(channelId));
    if (removedChannelIds.length) await knowledge.purgeMessageKnowledgeForChannels(request.auth.guildId, removedChannelIds);
    const saved = await knowledge.upsertSettings(request.auth.guildId, {
      enabled: input.enabled ?? current.enabled,
      channelIds: nextChannelIds,
      triggerMode: input.triggerMode ?? current.trigger_mode ?? 'mention_dm',
      retentionDays: input.retentionDays ?? current.retention_days ?? 30,
      perUserCooldownSeconds: input.perUserCooldownSeconds ?? current.per_user_cooldown_seconds ?? config.CHATBOT_PER_USER_COOLDOWN_SECONDS,
      dailyRequestLimit: input.dailyRequestLimit ?? current.daily_request_limit ?? config.CHATBOT_DAILY_REQUEST_LIMIT,
      model: input.model === undefined ? (current.model ?? config.GROQ_MODEL) : input.model,
    });
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'chatbot.settings_update', targetCategory: 'chatbot', metadata: { enabled: saved.enabled, channelCount: saved.channel_ids.length, triggerMode: saved.trigger_mode } });
    response.json(saved);
  }));

  router.get('/admin/chatbot/knowledge/status', requireCapability('chatbot.manage'), asyncRoute(async (request, response) => {
    response.json(await knowledge.status(request.auth.guildId));
  }));

  router.post('/admin/chatbot/knowledge/reindex', requireCapability('chatbot.manage'), csrf, asyncRoute(async (request, response) => {
    const result = await reindexCanonical({ guildId: request.auth.guildId, restClient, repository: knowledge });
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'chatbot.knowledge_reindex', targetCategory: 'knowledge', metadata: result });
    response.json(result);
  }));

  router.post('/admin/chatbot/knowledge/purge', requireCapability('chatbot.manage'), csrf, asyncRoute(async (request, response) => {
    const result = await knowledge.purgeMessageKnowledge(request.auth.guildId);
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'chatbot.knowledge_purge', targetCategory: 'knowledge', metadata: result });
    response.json(result);
  }));

  router.get('/admin/server/roles', requireCapability('server.roles.read'), asyncRoute(async (request, response) => {
    const readiness = await serverReadiness({ guildId: request.auth.guildId, restClient });
    response.json({ roles: readiness.roles, bot: readiness.bot, permissions: readiness.permissions });
  }));

  router.get('/admin/server/members', requireCapability('server.roles.read'), asyncRoute(async (request, response) => {
    const query = String(request.query.query ?? '').trim();
    if (!query) return response.json([]);
    const members = await restClient.searchGuildMembers(request.auth.guildId, query, Math.min(Number(request.query.limit) || 100, 1000));
    response.json(members.map(serializeDiscordMember));
  }));

  router.post('/admin/server/role-operations/preview', requireCapability('server.roles.assign'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ action: z.enum(['assign', 'remove']), roleId: snowflake, memberIds: z.array(snowflake).min(1).max(100) }).parse(request.body);
    response.json(await previewRoleOperation({ guildId: request.auth.guildId, restClient, ...input }));
  }));

  router.post('/admin/server/role-operations', requireCapability('server.roles.assign'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ action: z.enum(['assign', 'remove']), roleId: snowflake, memberIds: z.array(snowflake).min(1).max(100), reason: z.string().trim().min(1).max(512), confirmPhrase: z.string().trim().min(1).max(80), clientRequestId: uuid }).parse(request.body);
    const existing = await admin.findOperationByRequest(request.auth.guildId, input.clientRequestId);
    if (existing) return response.json({ idempotent: true, operation: existing });
    const preview = await previewRoleOperation({ guildId: request.auth.guildId, restClient, ...input });
    if (input.confirmPhrase !== preview.confirmationPhrase) throw new Error(`Confirmation must exactly equal ${preview.confirmationPhrase}.`);
    const operation = await admin.createOperation({ guildId: request.auth.guildId, actorUserId: request.auth.userId, operationType: input.action === 'assign' ? 'role_assign' : 'role_remove', targetId: input.roleId, clientRequestId: input.clientRequestId, confirmationPhrase: input.confirmPhrase, preview, payload: input });
    try {
      const result = await executeRoleOperation({ guildId: request.auth.guildId, restClient, ...input, preview });
      await admin.completeOperation({ id: operation.id, result: 'success', metadata: { affectedCount: result.affectedCount } });
      await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: `server.role_${input.action}`, targetCategory: 'role', targetId: input.roleId, reason: input.reason, metadata: { operationId: operation.id, affectedCount: result.affectedCount } });
      response.status(201).json({ operationId: operation.id, result });
    } catch (error) {
      await admin.completeOperation({ id: operation.id, result: 'failed', errorCode: error.code ?? 'ROLE_OPERATION_FAILED', metadata: { message: error.message } });
      throw error;
    }
  }));

  router.post('/admin/server/roles', requireCapability('server.roles.manage'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ name: z.string().trim().min(1).max(100), color: z.number().int().min(0).max(0xffffff).default(0), hoist: z.boolean().default(false), mentionable: z.boolean().default(false), reason: z.string().trim().min(1).max(512), confirm: z.literal(true), clientRequestId: uuid }).parse(request.body);
    const existing = await admin.findOperationByRequest(request.auth.guildId, input.clientRequestId);
    if (existing) return response.json({ idempotent: true, operation: existing });
    const operation = await admin.createOperation({ guildId: request.auth.guildId, actorUserId: request.auth.userId, operationType: 'role_create', clientRequestId: input.clientRequestId, confirmationPhrase: 'CONFIRMED', payload: input });
    try {
      const role = await createRole({ guildId: request.auth.guildId, restClient, payload: input, reason: input.reason });
      await admin.completeOperation({ id: operation.id, result: 'success', metadata: { roleId: role.id } });
      await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'server.role_create', targetCategory: 'role', targetId: role.id, reason: input.reason, metadata: { operationId: operation.id } });
      response.status(201).json({ operationId: operation.id, role });
    } catch (error) {
      await admin.completeOperation({ id: operation.id, result: 'failed', errorCode: error.code ?? 'ROLE_CREATE_FAILED', metadata: { message: error.message } });
      throw error;
    }
  }));

  router.patch('/admin/server/roles/:roleId', requireCapability('server.roles.manage'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ name: z.string().trim().min(1).max(100).optional(), color: z.number().int().min(0).max(0xffffff).optional(), hoist: z.boolean().optional(), mentionable: z.boolean().optional(), reason: z.string().trim().min(1).max(512), confirm: z.literal(true), clientRequestId: uuid }).parse(request.body);
    const existing = await admin.findOperationByRequest(request.auth.guildId, input.clientRequestId);
    if (existing) return response.json({ idempotent: true, operation: existing });
    const operation = await admin.createOperation({ guildId: request.auth.guildId, actorUserId: request.auth.userId, operationType: 'role_update', targetId: request.params.roleId, clientRequestId: input.clientRequestId, confirmationPhrase: 'CONFIRMED', payload: input });
    try {
      const role = await updateRole({ guildId: request.auth.guildId, restClient, roleId: request.params.roleId, payload: input, reason: input.reason });
      await admin.completeOperation({ id: operation.id, result: 'success', metadata: { roleId: role.id } });
      await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'server.role_update', targetCategory: 'role', targetId: role.id, reason: input.reason, metadata: { operationId: operation.id } });
      response.json({ operationId: operation.id, role });
    } catch (error) {
      await admin.completeOperation({ id: operation.id, result: 'failed', errorCode: error.code ?? 'ROLE_UPDATE_FAILED', metadata: { message: error.message } });
      throw error;
    }
  }));

  router.get('/admin/server/channels', requireCapability('server.channels.read'), asyncRoute(async (request, response) => {
    const readiness = await serverReadiness({ guildId: request.auth.guildId, restClient });
    const settings = await getGuildSettings(pool, request.auth.guildId);
    response.json({ channels: readiness.channels, bot: readiness.bot, permissions: readiness.permissions, settings: { moderation: settings.moderation ?? {} } });
  }));

  router.post('/admin/server/channels', requireCapability('server.channels.manage'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ type: z.number().int(), name: z.string().trim().min(1).max(100), parentId: snowflake.nullable().optional(), topic: z.string().max(1024).nullable().optional(), rateLimitPerUser: z.number().int().min(0).max(21600).optional(), nsfw: z.boolean().optional(), bitrate: z.number().int().positive().optional(), userLimit: z.number().int().min(0).max(99).optional(), reason: z.string().trim().min(1).max(512), confirm: z.literal(true), clientRequestId: uuid }).parse(request.body);
    const existing = await admin.findOperationByRequest(request.auth.guildId, input.clientRequestId);
    if (existing) return response.json({ idempotent: true, operation: existing });
    const operation = await admin.createOperation({ guildId: request.auth.guildId, actorUserId: request.auth.userId, operationType: 'channel_create', clientRequestId: input.clientRequestId, confirmationPhrase: 'CONFIRMED', payload: input });
    try {
      const channel = await createChannel({ guildId: request.auth.guildId, restClient, payload: input, reason: input.reason });
      await admin.completeOperation({ id: operation.id, result: 'success', metadata: { channelId: channel.id } });
      await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'server.channel_create', targetCategory: 'channel', targetId: channel.id, reason: input.reason, metadata: { operationId: operation.id } });
      response.status(201).json({ operationId: operation.id, channel });
    } catch (error) {
      await admin.completeOperation({ id: operation.id, result: 'failed', errorCode: error.code ?? 'CHANNEL_CREATE_FAILED', metadata: { message: error.message } });
      throw error;
    }
  }));

  router.patch('/admin/server/channels/:channelId', requireCapability('server.channels.manage'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ name: z.string().trim().min(1).max(100).optional(), parentId: snowflake.nullable().optional(), topic: z.string().max(1024).nullable().optional(), rateLimitPerUser: z.number().int().min(0).max(21600).optional(), nsfw: z.boolean().optional(), reason: z.string().trim().min(1).max(512), confirm: z.literal(true), clientRequestId: uuid }).parse(request.body);
    const existing = await admin.findOperationByRequest(request.auth.guildId, input.clientRequestId);
    if (existing) return response.json({ idempotent: true, operation: existing });
    const operation = await admin.createOperation({ guildId: request.auth.guildId, actorUserId: request.auth.userId, operationType: 'channel_update', targetId: request.params.channelId, clientRequestId: input.clientRequestId, confirmationPhrase: 'CONFIRMED', payload: input });
    try {
      const channel = await updateChannel({ guildId: request.auth.guildId, restClient, channelId: request.params.channelId, payload: input, reason: input.reason });
      await admin.completeOperation({ id: operation.id, result: 'success', metadata: { channelId: channel.id } });
      await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'server.channel_update', targetCategory: 'channel', targetId: channel.id, reason: input.reason, metadata: { operationId: operation.id } });
      response.json({ operationId: operation.id, channel });
    } catch (error) {
      await admin.completeOperation({ id: operation.id, result: 'failed', errorCode: error.code ?? 'CHANNEL_UPDATE_FAILED', metadata: { message: error.message } });
      throw error;
    }
  }));

  router.post('/admin/server/channels/:channelId/archive', requireCapability('server.channels.manage'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ archiveCategoryId: snowflake, reason: z.string().trim().min(1).max(512), confirm: z.literal(true), clientRequestId: uuid }).parse(request.body);
    const existing = await admin.findOperationByRequest(request.auth.guildId, input.clientRequestId);
    if (existing) return response.json({ idempotent: true, operation: existing });
    const operation = await admin.createOperation({ guildId: request.auth.guildId, actorUserId: request.auth.userId, operationType: 'channel_archive', targetId: request.params.channelId, clientRequestId: input.clientRequestId, confirmationPhrase: 'CONFIRMED', payload: input });
    try {
      const result = await archiveChannel({ guildId: request.auth.guildId, restClient, channelId: request.params.channelId, archiveCategoryId: input.archiveCategoryId, reason: input.reason });
      await admin.completeOperation({ id: operation.id, result: 'success', metadata: { archiveCategoryId: input.archiveCategoryId } });
      await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'server.channel_archive', targetCategory: 'channel', targetId: request.params.channelId, reason: input.reason, metadata: { operationId: operation.id, archiveCategoryId: input.archiveCategoryId } });
      response.json({ operationId: operation.id, result });
    } catch (error) {
      await admin.completeOperation({ id: operation.id, result: 'failed', errorCode: error.code ?? 'CHANNEL_ARCHIVE_FAILED', metadata: { message: error.message } });
      throw error;
    }
  }));

  router.get('/admin/greetings/templates', requireCapability('greetings.manage'), asyncRoute(async (request, response) => {
    const { rows } = await pool.query('select id, name, occasion, version, content, enabled, created_at from greeting_templates where guild_id = $1 order by name, version desc', [request.auth.guildId]);
    response.json(rows);
  }));

  router.post('/admin/greetings/preview', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ occasion: z.enum(['morning', 'afternoon', 'evening', 'night', 'custom']), roleId: snowflake, adm4: z.string().optional(), locationLabel: z.string().max(100).optional() }).parse(request.body);
    let weather = null;
    if (input.adm4) {
      try { weather = await bmkgClient.getForecast(input.adm4); } catch {}
    }
    response.json({ content: buildGreetingMessage({ occasion: input.occasion, roleMention: `<@&${input.roleId}>`, weather, locationLabel: input.locationLabel }) });
  }));

  router.post('/admin/greetings/send', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const input = z.object({ occasion: z.enum(['morning', 'afternoon', 'evening', 'night', 'custom']), roleId: snowflake, channelId: snowflake, adm4: z.string().optional(), locationLabel: z.string().max(100).optional(), confirm: z.literal(true) }).parse(request.body);
    if (input.roleId === request.auth.guildId) throw new Error('The @everyone role is not allowed for Greetings.');
    let weather = null;
    if (input.adm4) { try { weather = await bmkgClient.getForecast(input.adm4); } catch {} }
    const message = await restClient.sendChannelMessage(input.channelId, {
      content: buildGreetingMessage({ occasion: input.occasion, roleMention: `<@&${input.roleId}>`, weather, locationLabel: input.locationLabel }),
      allowed_mentions: { parse: [], roles: [input.roleId], users: [] },
    });
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'greeting.web_send', targetCategory: 'channel', targetId: input.channelId, metadata: { roleId: input.roleId, messageId: message.id } });
    response.json({ id: message.id, url: message.url });
  }));

  router.get('/admin/greetings/schedules', requireCapability('greetings.manage'), asyncRoute(async (request, response) => response.json(await greetings.listSchedules(request.auth.guildId))));
  router.post('/admin/greetings/schedules/:id/preview', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const schedule = await greetings.findSchedule(request.auth.guildId, request.params.id);
    if (!schedule) return response.status(404).json({ error: 'SCHEDULE_NOT_FOUND' });

    let weather = null;
    if (schedule.adm4) {
      try { weather = await bmkgClient.getForecast(schedule.adm4); } catch {}
    }
    response.json({
      schedule: { id: schedule.id, name: schedule.name, enabled: schedule.enabled },
      content: buildGreetingMessage({
        occasion: schedule.occasion,
        roleMention: `<@&${schedule.role_id}>`,
        weather,
        locationLabel: schedule.location_label,
      }),
    });
  }));
  router.post('/admin/greetings/schedules', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const input = scheduleSchema.parse(request.body);
    if (input.roleId === request.auth.guildId) throw new Error('The @everyone role is not allowed for Greetings.');
    const schedule = await greetings.createSchedule({ ...input, guildId: request.auth.guildId, actorUserId: request.auth.userId, ownerUserId: request.auth.guild.owner_id, name: input.name });
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'greeting.schedule_create', targetCategory: 'schedule', targetId: schedule.id });
    response.status(201).json(schedule);
  }));
  router.patch('/admin/greetings/schedules/:id', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const input = scheduleSchema.partial().extend({ enabled: z.boolean().optional() }).parse(request.body);
    if (input.roleId === request.auth.guildId) throw new Error('The @everyone role is not allowed for Greetings.');
    let schedule = await greetings.updateSchedule({ guildId: request.auth.guildId, identifier: request.params.id, changes: input });
    if (input.enabled !== undefined) schedule = await greetings.setScheduleEnabled({ guildId: request.auth.guildId, identifier: request.params.id, enabled: input.enabled });
    if (!schedule) return response.status(404).json({ error: 'SCHEDULE_NOT_FOUND' });
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'greeting.schedule_update', targetCategory: 'schedule', targetId: schedule.id });
    response.json(schedule);
  }));
  router.delete('/admin/greetings/schedules/:id', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const schedule = await greetings.deleteSchedule({ guildId: request.auth.guildId, identifier: request.params.id });
    if (!schedule) return response.status(404).json({ error: 'SCHEDULE_NOT_FOUND' });
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'greeting.schedule_delete', targetCategory: 'schedule', targetId: schedule.id });
    response.status(204).end();
  }));
  router.get('/admin/greetings/runs', requireCapability('greetings.manage'), asyncRoute(async (request, response) => response.json(await greetings.listRuns(request.auth.guildId, Number(request.query.limit) || 100))));
  router.get('/admin/audit', requireCapability('audit.read'), asyncRoute(async (request, response) => {
    const rows = await audit.list({ guildId: request.auth.guildId, limit: Number(request.query.limit) || 100, before: request.query.before ?? null });
    const actorIds = [...new Set(rows.map((row) => row.actor_user_id).filter(Boolean))];
    const actorLabels = new Map();
    await Promise.all(actorIds.map(async (actorId) => {
      try {
        const user = await restClient.getUser(actorId);
        actorLabels.set(actorId, `@${user.global_name ?? user.username}`);
      } catch {
        actorLabels.set(actorId, `<@${actorId}>`);
      }
    }));
    response.json(rows.map((row) => ({
      ...row,
      actor: row.actor_user_id ? actorLabels.get(row.actor_user_id) : 'System',
    })));
  }));

  return router;
}

module.exports = { asyncRoute, createApiRouter, scheduleSchema };
