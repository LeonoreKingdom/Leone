const { serialize } = require('cookie');
const { z } = require('zod');

const { AuditRepository } = require('../db/audit-repository');
const { checkDatabase } = require('../db/pool');
const { createBmkgClient } = require('../features/automation/morning/bmkg-client');
const { buildGreetingMessage } = require('../features/automation/greetings/greeting-message');
const { GreetingRepository } = require('../features/automation/greetings/greeting-repository');
const { BondService } = require('../features/relationships/bond-service');
const { createDefaultBondStore } = require('../features/relationships/bond-store');
const { FamilyTreeService } = require('../features/relationships/family-service');
const {
  CSRF_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  requireCapability,
  requireCsrf,
} = require('./auth');

const snowflake = z.string().regex(/^\d+$/);
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
  const greetings = new GreetingRepository(pool);
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
      pool.query('select scheduler_enabled, maintenance_mode, settings from guilds where id = $1', [request.auth.guildId]),
      pool.query('select role_id, capability from guild_capability_roles where guild_id = $1 order by capability, role_id', [request.auth.guildId]),
      restClient.getGuildBundle(request.auth.guildId, { refresh: true }),
    ]);
    response.json({
      ...guildResult.rows[0],
      capabilityRoles: mappingResult.rows,
      discordOptions: {
        roles: bundle.roles.filter((role) => role.id !== request.auth.guildId).map((role) => ({ id: role.id, name: role.name, color: role.color })),
        channels: bundle.channels.filter((channel) => [0, 5].includes(channel.type)).map((channel) => ({ id: channel.id, name: channel.name, parentId: channel.parent_id ?? null })),
      },
    });
  }));

  router.patch('/admin/config', requireCapability('config.write'), csrf, asyncRoute(async (request, response) => {
    const schema = z.object({
      schedulerEnabled: z.boolean().optional(),
      maintenanceMode: z.boolean().optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
      capabilityRoles: z.array(z.object({
        roleId: snowflake,
        capability: z.enum(['admin.read', 'config.write', 'greetings.manage', 'audit.read', 'relationships.abuse']),
      })).optional(),
    });
    const input = schema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update guilds set scheduler_enabled = coalesce($2, scheduler_enabled),
          maintenance_mode = coalesce($3, maintenance_mode),
          settings = coalesce($4::jsonb, settings), updated_at = now() where id = $1`,
        [request.auth.guildId, input.schedulerEnabled, input.maintenanceMode, input.settings ? JSON.stringify(input.settings) : null],
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
  router.post('/admin/greetings/schedules', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const input = scheduleSchema.parse(request.body);
    if (input.roleId === request.auth.guildId) throw new Error('The @everyone role is not allowed for Greetings.');
    const schedule = await greetings.createSchedule({ ...input, guildId: request.auth.guildId, actorUserId: request.auth.userId, ownerUserId: request.auth.guild.owner_id, name: input.name });
    await audit.record({ guildId: request.auth.guildId, actorUserId: request.auth.userId, action: 'greeting.schedule_create', targetCategory: 'schedule', targetId: schedule.id });
    response.status(201).json(schedule);
  }));
  router.patch('/admin/greetings/schedules/:id', requireCapability('greetings.manage'), csrf, asyncRoute(async (request, response) => {
    const input = scheduleSchema.partial().extend({ enabled: z.boolean().optional() }).parse(request.body);
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
  router.get('/admin/audit', requireCapability('audit.read'), asyncRoute(async (request, response) => response.json(await audit.list({ guildId: request.auth.guildId, limit: Number(request.query.limit) || 100, before: request.query.before ?? null }))));

  return router;
}

module.exports = { asyncRoute, createApiRouter, scheduleSchema };
