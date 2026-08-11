const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDiscoverQuery,
  describeMatch,
  selectMovies,
} = require('../src/features/recommendations/movie-recommender');
const {
  TmdbError,
  createTmdbClient,
  parseRetryAfter,
} = require('../src/features/recommendations/tmdb-client');
const {
  safeMovies,
} = require('../src/features/recommendations/movie.command');

test('movie preferences map to safe TMDB Discover filters', () => {
  const query = buildDiscoverQuery(
    {
      mood: 'exciting',
      genre: 'action',
      runtime: 'standard',
      originalLanguage: 'ja',
      era: 'recent',
      minimumRating: 7.5,
      locale: 'id-ID',
    },
    2026,
  );

  assert.deepEqual(query, {
    include_adult: false,
    include_video: false,
    language: 'id-ID',
    page: 1,
    sort_by: 'popularity.desc',
    'vote_average.gte': 7.5,
    'vote_count.gte': 100,
    with_genres: 28,
    'with_runtime.gte': 91,
    'with_runtime.lte': 120,
    'primary_release_date.gte': '2022-01-01',
    'primary_release_date.lte': '2026-12-31',
    with_original_language: 'ja',
  });
});

test('adult and incomplete results are never recommended', () => {
  const results = [
    {
      id: 1,
      title: 'Safe Action',
      release_date: '2025-01-01',
      adult: false,
      genre_ids: [28],
      vote_average: 8,
      popularity: 100,
    },
    {
      id: 2,
      title: 'Adult Result',
      release_date: '2025-01-01',
      adult: true,
      genre_ids: [28],
      vote_average: 10,
      popularity: 1000,
    },
    {
      id: 3,
      title: '',
      release_date: '2025-01-01',
      adult: false,
    },
  ];

  const movies = selectMovies(results, {
    genre: 'action',
  });

  assert.deepEqual(
    movies.map((movie) => movie.id),
    [1],
  );
  assert.match(
    describeMatch(movies[0], {
      genre: 'action',
    }),
    /Action/,
  );
});

test('TMDB client prefers the Read Access Token', async () => {
  let capturedUrl;
  let capturedOptions;
  const client = createTmdbClient({
    readAccessToken: 'read-token',
    apiKey: 'api-key',
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;

      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
        headers: new Headers(),
      };
    },
  });

  await client.discoverMovies({ include_adult: false });

  assert.equal(
    capturedOptions.headers.authorization,
    'Bearer read-token',
  );
  assert.equal(capturedUrl.searchParams.has('api_key'), false);
  assert.equal(
    capturedUrl.searchParams.get('include_adult'),
    'false',
  );
});

test('TMDB client supports API key authentication', async () => {
  let capturedUrl;
  const client = createTmdbClient({
    readAccessToken: '',
    apiKey: 'api-key',
    fetchImpl: async (url) => {
      capturedUrl = url;

      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
        headers: new Headers(),
      };
    },
  });

  await client.discoverMovies();

  assert.equal(
    capturedUrl.searchParams.get('api_key'),
    'api-key',
  );
});

test('TMDB client exposes movie browse, search, details, and trending endpoints', async () => {
  const requests = [];
  const client = createTmdbClient({
    readAccessToken: 'read-token',
    fetchImpl: async (url) => {
      requests.push(url);

      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
        headers: new Headers(),
      };
    },
  });

  await client.listMovies('popular', { page: 2 });
  await client.searchMovies('spirited away', { language: 'en-US' });
  await client.getMovieDetails(129, { language: 'en-US' });
  await client.trendingMovies('day', { language: 'en-US' });

  assert.deepEqual(
    requests.map((url) => `${url.pathname}${url.search}`),
    [
      '/3/movie/popular?page=2',
      '/3/search/movie?language=en-US&query=spirited+away&include_adult=false',
      '/3/movie/129?language=en-US',
      '/3/trending/movie/day?language=en-US',
    ],
  );
});

test('movie catalog results exclude adult and incomplete entries', () => {
  assert.deepEqual(
    safeMovies([
      { id: 1, title: 'Safe', adult: false },
      { id: 2, title: 'Adult', adult: true },
      { id: 3, title: '', adult: false },
      { id: 4, name: 'Localized safe title', adult: false },
    ]).map((movie) => movie.id),
    [1, 4],
  );
});

test('TMDB client reports missing credentials safely', async () => {
  const client = createTmdbClient({
    readAccessToken: '',
    apiKey: '',
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });

  await assert.rejects(
    () => client.discoverMovies(),
    (error) =>
      error instanceof TmdbError &&
      error.code === 'CONFIGURATION' &&
      !error.message.includes('undefined'),
  );
});

test('Retry-After is parsed without exposing credentials', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('invalid'), null);
});
