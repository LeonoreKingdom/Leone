const { createHash, randomBytes } = require('node:crypto');

function hashToken(value) {
  return createHash('sha256').update(value).digest('hex');
}

class SessionRepository {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.ttlHours = options.ttlHours ?? 24;
  }

  async create({ guildId, userId }) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);

    await this.pool.query(
      `insert into oauth_sessions
         (session_hash, csrf_hash, guild_id, user_id, expires_at)
       values ($1,$2,$3,$4,$5)`,
      [hashToken(token), hashToken(csrfToken), guildId, userId, expiresAt],
    );
    return { token, csrfToken, expiresAt };
  }

  async get(token) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const { rows } = await this.pool.query(
      `update oauth_sessions
          set last_seen_at = now()
        where session_hash = $1 and expires_at > now()
        returning session_hash, csrf_hash, guild_id, user_id,
                  created_at, last_seen_at, expires_at`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async delete(token) {
    if (!token) return false;
    const result = await this.pool.query(
      'delete from oauth_sessions where session_hash = $1',
      [hashToken(token)],
    );
    return result.rowCount > 0;
  }

  verifyCsrf(session, csrfToken) {
    if (!session || !csrfToken) return false;
    return hashToken(csrfToken) === session.csrf_hash;
  }
}

module.exports = {
  SessionRepository,
  hashToken,
};
