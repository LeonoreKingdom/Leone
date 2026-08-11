const JIKAN_API_BASE_URL = 'https://api.jikan.moe/v4';

class JikanError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'JikanError';
    this.code = options.code ?? 'JIKAN_ERROR';
    this.status = options.status ?? null;
  }
}

function createJikanClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new JikanError('This Node.js runtime does not provide fetch.', {
      code: 'CONFIGURATION',
    });
  }

  async function request(path, query = {}) {
    const url = new URL(`${JIKAN_API_BASE_URL}${path}`);

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
        throw new JikanError('Jikan request timed out.', {
          code: 'TIMEOUT',
        });
      }

      throw new JikanError('Jikan could not be reached.', {
        code: 'UNAVAILABLE',
      });
    }

    if (response.status === 429) {
      throw new JikanError('Jikan rate limit reached.', {
        code: 'RATE_LIMIT',
        status: response.status,
      });
    }

    if (!response.ok) {
      throw new JikanError(`Jikan returned HTTP ${response.status}.`, {
        code: 'UPSTREAM',
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch {
      throw new JikanError('Jikan returned invalid JSON.', {
        code: 'INVALID_RESPONSE',
        status: response.status,
      });
    }
  }

  function validatePage(page) {
    const value = Number(page ?? 1);

    if (!Number.isInteger(value) || value < 1 || value > 500) {
      throw new JikanError('Anime page must be between 1 and 500.', {
        code: 'INVALID_REQUEST',
      });
    }

    return value;
  }

  return {
    listAnime(filter = 'bypopularity', page = 1) {
      const allowedFilters = new Set([
        'airing',
        'upcoming',
        'bypopularity',
        'favorite',
      ]);

      if (!allowedFilters.has(filter)) {
        throw new JikanError('Unknown anime list filter.', {
          code: 'INVALID_REQUEST',
        });
      }

      return request('/top/anime', {
        filter,
        page: validatePage(page),
        sfw: true,
      });
    },
    searchAnime(query = '', page = 1, options = {}) {
      const cleanQuery = String(query).trim();

      return request('/anime', {
        ...options,
        page: validatePage(page),
        q: cleanQuery,
        sfw: true,
      });
    },
    getAnimeDetails(animeId) {
      if (!/^\d+$/.test(String(animeId))) {
        throw new JikanError('Anime ID must be a positive integer.', {
          code: 'INVALID_REQUEST',
        });
      }

      return request(`/anime/${encodeURIComponent(String(animeId))}/full`);
    },
    listSeasonalAnime(year, season, page = 1) {
      const numericYear = Number(year);
      const allowedSeasons = new Set([
        'winter',
        'spring',
        'summer',
        'fall',
      ]);

      if (
        !Number.isInteger(numericYear) ||
        numericYear < 1900 ||
        numericYear > 2100 ||
        !allowedSeasons.has(season)
      ) {
        throw new JikanError('Anime season or year is not valid.', {
          code: 'INVALID_REQUEST',
        });
      }

      return request(`/seasons/${numericYear}/${season}`, {
        page: validatePage(page),
        sfw: true,
      });
    },
  };
}

module.exports = {
  JIKAN_API_BASE_URL,
  JikanError,
  createJikanClient,
};
