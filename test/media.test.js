const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAniListMediaClient,
  normalizeMedia,
} = require('../src/features/reading/anilist-media-client');
const {
  createRawgClient,
  RawgError,
} = require('../src/features/games/rawg-client');
const {
  createTmdbClient,
  TmdbError,
} = require('../src/features/recommendations/tmdb-client');
const {
  safeGames,
} = require('../src/features/games/game-presenter');
const {
  safeReading,
} = require('../src/features/reading/reading-presenter');

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    headers: new Headers(),
  };
}

test('RAWG client uses a server-side API key and supports game search/details', async () => {
  const requests = [];
  const client = createRawgClient({
    apiKey: 'rawg-test-key',
    fetchImpl: async (url) => {
      requests.push(url);
      return okJson({ results: [{ id: 1, name: 'Valorant' }] });
    },
  });

  await client.searchGames('Valorant', { page: 2 });
  await client.getGameDetails('valorant');

  assert.equal(requests[0].searchParams.get('key'), 'rawg-test-key');
  assert.equal(requests[0].searchParams.get('search'), 'Valorant');
  assert.equal(requests[0].searchParams.get('page'), '2');
  assert.equal(requests[1].pathname, '/api/games/valorant');
});

test('RAWG client reports missing credentials without making a request', async () => {
  const client = createRawgClient({ apiKey: '', fetchImpl: async () => { throw new Error('not called'); } });
  await assert.rejects(
    () => client.listGames(),
    (error) => error instanceof RawgError && error.code === 'CONFIGURATION',
  );
});

test('AniList reading client sends format and country filters', async () => {
  let capturedBody;
  const client = createAniListMediaClient({
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return okJson({
        data: {
          Page: {
            pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false },
            media: [{
              id: 100,
              title: { english: 'A Korean title', romaji: 'Korean' },
              description: '<br>Synopsis',
              type: 'MANGA',
              format: 'MANHWA',
              countryOfOrigin: 'KR',
              averageScore: 88,
              genres: ['Fantasy'],
              coverImage: { large: 'https://example.com/cover.jpg' },
            }],
          },
        },
      });
    },
  });

  const result = await client.searchMedia('Korean', {
    format: 'MANGA',
    country: 'KR',
  });

  assert.equal(capturedBody.variables.format, 'MANGA');
  assert.equal(capturedBody.variables.country, 'KR');
  assert.equal(result.data[0].title, 'A Korean title');
  assert.equal(result.data[0].countryOfOrigin, 'KR');
  assert.equal(result.data[0].score, 8.8);
  assert.equal(result.data[0].synopsis, 'Synopsis');
});

test('TMDB client supports TV series browse/search/details/trending', async () => {
  const requests = [];
  const client = createTmdbClient({
    apiKey: 'tmdb-test-key',
    readAccessToken: '',
    fetchImpl: async (url) => {
      requests.push(url);
      return okJson({ results: [] });
    },
  });

  await client.listTv('popular', { page: 2 });
  await client.searchTv('Arcane', { language: 'en-US' });
  await client.getTvDetails(123, { language: 'en-US' });
  await client.trendingTv('week', { language: 'en-US' });

  assert.deepEqual(
    requests.map((url) => `${url.pathname}${url.search}`),
    [
      '/3/tv/popular?page=2&api_key=tmdb-test-key',
      '/3/search/tv?language=en-US&query=Arcane&include_adult=false&api_key=tmdb-test-key',
      '/3/tv/123?language=en-US&api_key=tmdb-test-key',
      '/3/trending/tv/week?language=en-US&api_key=tmdb-test-key',
    ],
  );
});

test('media presenters filter incomplete results', () => {
  assert.deepEqual(safeGames([
    { id: 1, name: 'Valid' },
    { id: 2, name: '' },
  ]).map((item) => item.id), [1]);
  assert.deepEqual(safeReading([
    { id: 1, title: 'Valid' },
    { id: 2, title: '' },
  ]).map((item) => item.id), [1]);
});

test('TMDB TV details reject invalid IDs', () => {
  const client = createTmdbClient({ apiKey: 'test', fetchImpl: async () => okJson({}) });
  assert.throws(
    () => client.getTvDetails('not-a-number'),
    (error) => error instanceof TmdbError && error.code === 'INVALID_REQUEST',
  );
});
