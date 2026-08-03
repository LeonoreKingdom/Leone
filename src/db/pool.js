const { Pool } = require('pg');

const { requireConfig } = require('../config');

let pool;

function createPool(connectionString = null) {
  const url =
    connectionString ?? requireConfig('DATABASE_URL').DATABASE_URL;

  return new Pool({
    connectionString: url,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 10_000,
    max: 3,
    query_timeout: 12_000,
    ssl:
      url.includes('localhost') || url.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
  });
}

function getPool() {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

async function withTransaction(callback, options = {}) {
  const client = await (options.pool ?? getPool()).connect();

  try {
    await client.query('BEGIN');

    if (options.isolationLevel) {
      await client.query(
        `SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`,
      );
    }

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function checkDatabase(poolOverride = null) {
  const startedAt = Date.now();
  await (poolOverride ?? getPool()).query('select 1 as healthy');
  return { latencyMs: Date.now() - startedAt };
}

async function closePool() {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

module.exports = {
  checkDatabase,
  closePool,
  createPool,
  getPool,
  withTransaction,
};
