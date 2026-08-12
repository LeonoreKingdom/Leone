const RAWG_API_BASE_URL = 'https://api.rawg.io/api';

class RawgError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'RawgError';
    this.code = options.code ?? 'RAWG_ERROR';
    this.status = options.status ?? null;
  }
}

function createRawgClient(options = {}) {
  const apiKey = options.apiKey ?? process.env.RAWG_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new RawgError('This Node.js runtime does not provide fetch.', {
      code: 'CONFIGURATION',
    });
  }

  async function request(path, query = {}) {
    if (!apiKey) {
      throw new RawgError(
        'RAWG is not configured. Set RAWG_API_KEY.',
        { code: 'CONFIGURATION' },
      );
    }

    const url = new URL(`${RAWG_API_BASE_URL}${path}`);
    url.searchParams.set('key', apiKey);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Leone Discord Bot',
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new RawgError('RAWG request timed out.', { code: 'TIMEOUT' });
      }

      throw new RawgError('RAWG could not be reached.', {
        code: 'UNAVAILABLE',
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new RawgError('RAWG rejected the configured API key.', {
        code: 'AUTHENTICATION',
        status: response.status,
      });
    }

    if (response.status === 429) {
      throw new RawgError('RAWG rate limit reached.', {
        code: 'RATE_LIMIT',
        status: response.status,
      });
    }

    if (!response.ok) {
      throw new RawgError(`RAWG returned HTTP ${response.status}.`, {
        code: 'UPSTREAM',
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch {
      throw new RawgError('RAWG returned invalid JSON.', {
        code: 'INVALID_RESPONSE',
        status: response.status,
      });
    }
  }

  function pageSizeFn(value = 5) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 40) {
      throw new RawgError('Game page size must be between 1 and 40.', {
        code: 'INVALID_REQUEST',
      });
    }
    return number;
  }

  return {
    searchGames(query, options = {}) {
      const cleanQuery = String(query ?? '').trim();
      if (!cleanQuery) {
        throw new RawgError('A game search query is required.', {
          code: 'INVALID_REQUEST',
        });
      }

      const { pageSize, ...queryOptions } = options;
      return request('/games', {
        ...queryOptions,
        search: cleanQuery,
        page: Number(options.page ?? 1),
        page_size: pageSizeFn(pageSize ?? 5),
      });
    },
    listGames(options = {}) {
      const { pageSize, ...queryOptions } = options;
      return request('/games', {
        ...queryOptions,
        page: Number(options.page ?? 1),
        page_size: pageSizeFn(pageSize ?? 5),
      });
    },
    getGameDetails(gameId) {
      const value = String(gameId ?? '').trim();
      if (!value || value.length > 100 || !/^[a-zA-Z0-9-]+$/.test(value)) {
        throw new RawgError('Game ID must be a valid RAWG identifier.', {
          code: 'INVALID_REQUEST',
        });
      }

      return request(`/games/${encodeURIComponent(value)}`);
    },
  };
}

module.exports = {
  RAWG_API_BASE_URL,
  RawgError,
  createRawgClient,
};
