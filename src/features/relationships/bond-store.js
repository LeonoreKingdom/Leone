const {
  mkdir,
  readFile,
  rename,
  writeFile,
} = require('node:fs/promises');
const path = require('node:path');

const { getPool, withTransaction } = require('../../db/pool');

function createEmptyState() {
  return {
    version: 1,
    members: {},
    requests: [],
    edges: [],
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function validateState(state) {
  if (
    !state ||
    state.version !== 1 ||
    !state.members ||
    !Array.isArray(state.requests) ||
    !Array.isArray(state.edges)
  ) {
    throw new Error('The Leone Bonds data file is invalid.');
  }

  return state;
}

class JsonBondStore {
  /**
   * @param {{filePath?: string}} options
   */
  constructor(options = {}) {
    this.filePath =
      options.filePath ??
      process.env.BONDS_DATA_FILE ??
      path.resolve(
        __dirname,
        '../../../data/bonds.json',
      );
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return validateState(JSON.parse(contents));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return createEmptyState();
      }

      throw error;
    }
  }

  async save(state) {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
    await rename(temporaryPath, this.filePath);
  }

  /**
   * @template T
   * @param {(state: ReturnType<typeof createEmptyState>) => T | Promise<T>} reader
   * @returns {Promise<T>}
   */
  async read(reader) {
    await this.queue;
    return reader(cloneState(await this.load()));
  }

  /**
   * Serialize mutations so concurrent interactions cannot overwrite
   * one another.
   *
   * @template T
   * @param {(state: ReturnType<typeof createEmptyState>) => T | Promise<T>} mutator
   * @returns {Promise<T>}
   */
  async transact(mutator) {
    const operation = this.queue.then(async () => {
      const state = await this.load();
      const result = await mutator(state);

      validateState(state);
      await this.save(state);
      return result;
    });

    this.queue = operation.catch(() => {});
    return operation;
  }
}

class MemoryBondStore {
  constructor(initialState = createEmptyState()) {
    this.state = cloneState(initialState);
    this.queue = Promise.resolve();
  }

  async read(reader) {
    await this.queue;
    return reader(cloneState(this.state));
  }

  async transact(mutator) {
    const operation = this.queue.then(async () => {
      const nextState = cloneState(this.state);
      const result = await mutator(nextState);

      validateState(nextState);
      this.state = nextState;
      return result;
    });

    this.queue = operation.catch(() => {});
    return operation;
  }
}

class PostgresBondStore {
  constructor(options = {}) {
    this.pool = options.pool ?? getPool();
  }

  async load(client) {
    const [profiles, blocks, requests, edges] = await Promise.all([
      client.query(
        'select guild_id, user_id, visibility from member_privacy',
      ),
      client.query(
        'select guild_id, blocker_user_id, blocked_user_id from bond_blocks',
      ),
      client.query(`
        select id, guild_id, requester_user_id, target_user_id,
               requested_type, relationship_type, from_user_id,
               to_user_id, created_at, expires_at
          from bond_requests
         where expires_at > now()
      `),
      client.query(`
        select id, guild_id, relationship_type, from_user_id,
               to_user_id, created_at
          from bonds
      `),
    ]);
    const state = createEmptyState();

    for (const row of profiles.rows) {
      state.members[memberKey(row.guild_id, row.user_id)] = {
        visibility: row.visibility,
        blockedUserIds: [],
      };
    }

    for (const row of blocks.rows) {
      const key = memberKey(row.guild_id, row.blocker_user_id);
      state.members[key] ??= {
        visibility: 'private',
        blockedUserIds: [],
      };
      state.members[key].blockedUserIds.push(row.blocked_user_id);
    }

    state.requests = requests.rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      requesterId: row.requester_user_id,
      targetId: row.target_user_id,
      requestedType: row.requested_type,
      type: row.relationship_type,
      fromId: row.from_user_id,
      toId: row.to_user_id,
      createdAt: new Date(row.created_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
    }));
    state.edges = edges.rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      type: row.relationship_type,
      fromId: row.from_user_id,
      toId: row.to_user_id,
      createdAt: new Date(row.created_at).getTime(),
    }));
    return state;
  }

  async read(reader) {
    return withTransaction(
      async (client) => reader(cloneState(await this.load(client))),
      { pool: this.pool, isolationLevel: 'REPEATABLE READ' },
    );
  }

  async persist(client, state) {
    validateState(state);
    const guildIds = new Set();

    for (const key of Object.keys(state.members)) {
      guildIds.add(key.split(':', 1)[0]);
    }
    for (const item of [...state.requests, ...state.edges]) {
      guildIds.add(item.guildId);
    }

    for (const guildId of guildIds) {
      await client.query(
        `insert into guilds (id, name)
         values ($1, $1)
         on conflict (id) do nothing`,
        [guildId],
      );
    }

    await client.query('delete from bond_blocks');
    await client.query('delete from bond_requests');
    await client.query('delete from bonds');
    await client.query('delete from member_privacy');

    for (const [key, profile] of Object.entries(state.members)) {
      const separator = key.indexOf(':');
      const guildId = key.slice(0, separator);
      const userId = key.slice(separator + 1);

      await client.query(
        `insert into member_privacy (guild_id, user_id, visibility)
         values ($1, $2, $3)`,
        [guildId, userId, profile.visibility ?? 'private'],
      );

      for (const blockedUserId of profile.blockedUserIds ?? []) {
        await client.query(
          `insert into bond_blocks
             (guild_id, blocker_user_id, blocked_user_id)
           values ($1, $2, $3)`,
          [guildId, userId, blockedUserId],
        );
      }
    }

    for (const request of state.requests) {
      await client.query(
        `insert into bond_requests (
           id, guild_id, requester_user_id, target_user_id,
           requested_type, relationship_type, from_user_id,
           to_user_id, created_at, expires_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          request.id,
          request.guildId,
          request.requesterId,
          request.targetId,
          request.requestedType,
          request.type,
          request.fromId,
          request.toId,
          new Date(request.createdAt),
          new Date(request.expiresAt),
        ],
      );
    }

    for (const edge of state.edges) {
      await client.query(
        `insert into bonds (
           id, guild_id, relationship_type, from_user_id,
           to_user_id, created_at
         ) values ($1,$2,$3,$4,$5,$6)`,
        [
          edge.id,
          edge.guildId,
          edge.type,
          edge.fromId,
          edge.toId,
          new Date(edge.createdAt),
        ],
      );
    }
  }

  async transact(mutator) {
    return withTransaction(
      async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtext('leone:bonds'))",
        );
        await client.query(
          'delete from bond_requests where expires_at <= now()',
        );
        const state = await this.load(client);
        const result = await mutator(state);
        await this.persist(client, state);
        return result;
      },
      { pool: this.pool, isolationLevel: 'SERIALIZABLE' },
    );
  }
}

function memberKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function createDefaultBondStore() {
  return process.env.DATABASE_URL
    ? new PostgresBondStore()
    : new JsonBondStore();
}

module.exports = {
  JsonBondStore,
  MemoryBondStore,
  PostgresBondStore,
  createDefaultBondStore,
  createEmptyState,
};
