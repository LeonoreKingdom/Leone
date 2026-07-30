const { setTimeout: delay } = require('node:timers/promises');

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

class TmdbError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'TmdbError';
    this.code = options.code ?? 'TMDB_ERROR';
    this.status = options.status ?? null;
  }
}

function parseRetryAfter(value) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, timestamp - Date.now());
}

function createTmdbClient(options = {}) {
  const readAccessToken =
    options.readAccessToken ??
    process.env.TMDB_READ_ACCESS_TOKEN;
  const apiKey =
    options.apiKey ?? process.env.TMDB_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? delay;

  if (typeof fetchImpl !== 'function') {
    throw new TmdbError(
      'This Node.js runtime does not provide fetch.',
      { code: 'CONFIGURATION' },
    );
  }

  async function request(path, query = {}, retryCount = 0) {
    if (!readAccessToken && !apiKey) {
      throw new TmdbError(
        'TMDB is not configured. Set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY.',
        { code: 'CONFIGURATION' },
      );
    }

    const url = new URL(`${TMDB_API_BASE_URL}${path}`);

    for (const [key, value] of Object.entries(query)) {
      if (
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {
        url.searchParams.set(key, String(value));
      }
    }

    if (!readAccessToken) {
      url.searchParams.set('api_key', apiKey);
    }

    const headers = {
      accept: 'application/json',
    };

    if (readAccessToken) {
      headers.authorization = `Bearer ${readAccessToken}`;
    }

    let response;

    try {
      response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        error?.name === 'TimeoutError'
      ) {
        throw new TmdbError('TMDB request timed out.', {
          code: 'TIMEOUT',
        });
      }

      throw new TmdbError('TMDB could not be reached.', {
        code: 'UNAVAILABLE',
      });
    }

    if (response.status === 429) {
      const retryAfter = parseRetryAfter(
        response.headers.get('retry-after'),
      );

      if (
        retryCount === 0 &&
        retryAfter !== null &&
        retryAfter <= 5_000
      ) {
        await sleep(retryAfter);
        return request(path, query, retryCount + 1);
      }

      throw new TmdbError(
        'TMDB rate limit reached. Please try again shortly.',
        {
          code: 'RATE_LIMIT',
          status: response.status,
        },
      );
    }

    if (response.status === 401) {
      throw new TmdbError(
        'TMDB rejected the configured credential.',
        {
          code: 'AUTHENTICATION',
          status: response.status,
        },
      );
    }

    if (!response.ok) {
      throw new TmdbError(
        `TMDB returned HTTP ${response.status}.`,
        {
          code: 'UPSTREAM',
          status: response.status,
        },
      );
    }

    try {
      return await response.json();
    } catch {
      throw new TmdbError('TMDB returned invalid JSON.', {
        code: 'INVALID_RESPONSE',
        status: response.status,
      });
    }
  }

  return {
    discoverMovies(query) {
      return request('/discover/movie', query);
    },
  };
}

module.exports = {
  TMDB_API_BASE_URL,
  TmdbError,
  createTmdbClient,
  parseRetryAfter,
};
