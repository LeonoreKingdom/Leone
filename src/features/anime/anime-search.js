const { createAniListClient } = require('./anilist-client');
const { JikanError } = require('./jikan-client');

function shouldUseFallback(error) {
  return error instanceof JikanError && [
    'RATE_LIMIT',
    'TIMEOUT',
    'UNAVAILABLE',
    'UPSTREAM',
  ].includes(error.code);
}

async function searchAnimeWithFallback({ jikanClient, query, page = 1, options = {}, fallbackClient = null }) {
  try {
    return {
      ...(await jikanClient.searchAnime(query, page, options)),
      source: 'jikan',
    };
  } catch (error) {
    if (!shouldUseFallback(error)) throw error;

    const aniListClient = fallbackClient ?? createAniListClient();
    const fallbackOptions = options.fallback ?? {};
    return aniListClient.searchAnime(query, {
      page,
      perPage: 5,
      genre: fallbackOptions.genre,
      format: fallbackOptions.format,
      sort: fallbackOptions.sort === 'desc' ? 'SCORE_DESC' : 'SEARCH_MATCH',
    });
  }
}

module.exports = {
  searchAnimeWithFallback,
  shouldUseFallback,
};
