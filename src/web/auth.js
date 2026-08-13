const {
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require('node:crypto');
const { parse, serialize } = require('cookie');

const ALL_CAPABILITIES = [
  'admin.read',
  'config.write',
  'greetings.manage',
  'audit.read',
  'relationships.abuse',
  'moderation.read',
  'moderation.warn',
  'moderation.timeout',
  'moderation.kick',
  'moderation.ban',
  'moderation.messages',
  'server.roles.read',
  'server.roles.assign',
  'server.roles.manage',
  'server.channels.read',
  'server.channels.manage',
  'chatbot.manage',
];
const SESSION_COOKIE = 'leone_session';
const OAUTH_STATE_COOKIE = 'leone_oauth_state';
const CSRF_COOKIE = 'leone_csrf';

function signState(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function createState(secret) {
  const value = `${Date.now()}.${randomBytes(24).toString('base64url')}`;
  return `${value}.${signState(value, secret)}`;
}

function verifyState(state, cookieState, secret) {
  if (!state || state !== cookieState) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const value = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signState(value, secret));
  const supplied = Buffer.from(parts[2]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  return Date.now() - Number(parts[0]) < 10 * 60 * 1000;
}

function cookieOptions(config, expires = null) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    expires: expires ?? undefined,
  };
}

async function exchangeCode(config, code) {
  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${config.PUBLIC_WEB_ORIGIN}/auth/discord/callback`,
  });
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Discord rejected the OAuth authorization code.');
  return response.json();
}

async function fetchOauthResource(token, path) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const error = new Error('Discord OAuth membership verification failed.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function createAuthRouter({ express, config, sessionRepository, pool, restClient, auditRepository }) {
  const router = express.Router();

  router.get('/discord', (request, response) => {
    const state = createState(config.SESSION_SECRET);
    response.setHeader('Set-Cookie', serialize(OAUTH_STATE_COOKIE, state, {
      ...cookieOptions(config, new Date(Date.now() + 10 * 60 * 1000)),
      maxAge: 600,
    }));
    const query = new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: `${config.PUBLIC_WEB_ORIGIN}/auth/discord/callback`,
      scope: 'identify guilds.members.read',
      state,
    });
    response.redirect(`https://discord.com/oauth2/authorize?${query}`);
  });

  router.get('/discord/callback', async (request, response, next) => {
    try {
      const cookies = parse(request.headers.cookie ?? '');
      if (!verifyState(request.query.state, cookies[OAUTH_STATE_COOKIE], config.SESSION_SECRET)) {
        response.status(400).send('Invalid or expired OAuth state.');
        return;
      }
      const token = await exchangeCode(config, request.query.code);
      const [user, member] = await Promise.all([
        fetchOauthResource(token.access_token, '/users/@me'),
        fetchOauthResource(token.access_token, `/users/@me/guilds/${config.DISCORD_GUILD_ID}/member`),
      ]);
      if (!member?.roles) {
        response.status(403).send('You must be a current member of Leonore’s Kingdom.');
        return;
      }
      const guildBundle = await restClient.getGuildBundle(config.DISCORD_GUILD_ID);
      await pool.query(
        `insert into guilds (id, name, owner_user_id)
         values ($1,$2,$3)
         on conflict (id) do update
           set name = excluded.name, owner_user_id = excluded.owner_user_id,
               updated_at = now()`,
        [config.DISCORD_GUILD_ID, guildBundle.guild.name, guildBundle.guild.owner_id],
      );
      await sessionRepository.delete(cookies[SESSION_COOKIE]);
      const session = await sessionRepository.create({
        guildId: config.DISCORD_GUILD_ID,
        userId: user.id,
      });
      await auditRepository.record({
        guildId: config.DISCORD_GUILD_ID,
        actorUserId: user.id,
        action: 'auth.login',
        targetCategory: 'session',
      });
      response.setHeader('Set-Cookie', [
        serialize(SESSION_COOKIE, session.token, {
          ...cookieOptions(config, session.expiresAt),
          maxAge: Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
        }),
        serialize(OAUTH_STATE_COOKIE, '', {
          ...cookieOptions(config, new Date(0)),
          maxAge: 0,
        }),
        serialize(CSRF_COOKIE, session.csrfToken, {
          ...cookieOptions(config, session.expiresAt),
          httpOnly: false,
          maxAge: Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
        }),
      ]);
      response.redirect('/admin');
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function createAuthMiddleware({ config, sessionRepository, restClient, pool }) {
  return async function authenticate(request, response, next) {
    try {
      const cookies = parse(request.headers.cookie ?? '');
      const rawToken = cookies[SESSION_COOKIE];
      const session = await sessionRepository.get(rawToken);
      if (!session) {
        response.status(401).json({ error: 'AUTH_REQUIRED' });
        return;
      }
      let member;
      try {
        member = await restClient.getGuildMember(session.guild_id, session.user_id);
      } catch (error) {
        if (error.status === 404) {
          await sessionRepository.delete(rawToken);
          response.status(403).json({ error: 'GUILD_MEMBERSHIP_REQUIRED' });
          return;
        }
        throw error;
      }
      const bundle = await restClient.getGuildBundle(session.guild_id);
      const capabilities = new Set();
      if (bundle.guild.owner_id === session.user_id) {
        ALL_CAPABILITIES.forEach((capability) => capabilities.add(capability));
      } else if (member.roles?.length) {
        const { rows } = await pool.query(
          `select capability from guild_capability_roles
            where guild_id = $1 and role_id = any($2::text[])`,
          [session.guild_id, member.roles],
        );
        rows.forEach((row) => capabilities.add(row.capability));
      }
      request.auth = {
        capabilities,
        csrfHash: session.csrf_hash,
        guild: bundle.guild,
        guildId: session.guild_id,
        member,
        rawSessionToken: rawToken,
        session,
        user: member.user,
        userId: session.user_id,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireCapability(capability) {
  return (request, response, next) => {
    if (!request.auth?.capabilities.has(capability)) {
      response.status(403).json({ error: 'CAPABILITY_REQUIRED', capability });
      return;
    }
    next();
  };
}

function requireCsrf(sessionRepository) {
  return (request, response, next) => {
    if (!sessionRepository.verifyCsrf(request.auth?.session, request.get('x-csrf-token'))) {
      response.status(403).json({ error: 'CSRF_INVALID' });
      return;
    }
    next();
  };
}

module.exports = {
  ALL_CAPABILITIES,
  CSRF_COOKIE,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createAuthMiddleware,
  createAuthRouter,
  createState,
  cookieOptions,
  requireCapability,
  requireCsrf,
  verifyState,
};
