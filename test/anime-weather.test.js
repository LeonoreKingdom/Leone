const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createJikanClient,
  JikanError,
} = require('../src/features/anime/jikan-client');
const {
  createAniListClient,
  normalizeMedia,
} = require('../src/features/anime/anilist-client');
const {
  searchAnimeWithFallback,
} = require('../src/features/anime/anime-search');
const {
  currentSeason,
} = require('../src/features/anime/anime.command');
const {
  getAnimeTitle,
  safeAnime,
} = require('../src/features/anime/anime-presenter');
const {
  createOpenMeteoClient,
} = require('../src/features/weather/open-meteo-client');
const {
  getWeatherLabel,
} = require('../src/features/weather/weather-presenter');

test('Jikan client builds safe anime list, search, details, and seasonal requests', async () => {
  const requests = [];
  const client = createJikanClient({
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
        headers: new Headers(),
      };
    },
  });

  await client.listAnime('bypopularity', 2);
  await client.searchAnime('Frieren', 1, { limit: 5 });
  await client.getAnimeDetails(52991);
  await client.listSeasonalAnime(2026, 'summer', 1);

  assert.deepEqual(
    requests.map((url) => `${url.pathname}${url.search}`),
    [
      '/v4/top/anime?filter=bypopularity&page=2&sfw=true',
      '/v4/anime?limit=5&page=1&q=Frieren&sfw=true',
      '/v4/anime/52991/full',
      '/v4/seasons/2026/summer?page=1&sfw=true',
    ],
  );
});

test('anime presentation filters incomplete entries and picks readable titles', () => {
  assert.equal(getAnimeTitle({ title_english: 'English title', title: 'Original' }), 'English title');
  assert.deepEqual(
    safeAnime([
      { mal_id: 1, title: 'Valid' },
      { mal_id: 2, title: '' },
      { mal_id: 3, title_japanese: 'Japanese title' },
    ]).map((anime) => anime.mal_id),
    [1, 3],
  );
});

test('AniList fallback normalizes search results to the anime embed model', async () => {
  let capturedBody;
  const client = createAniListClient({
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            Page: {
              pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false },
              media: [{
                id: 100,
                idMal: 101,
                siteUrl: 'https://anilist.co/anime/100',
                title: { english: 'Fallback title', romaji: 'Fallback' },
                description: 'A <br> synopsis.',
                type: 'TV',
                episodes: 12,
                status: 'FINISHED',
                averageScore: 84,
                popularity: 200,
                genres: ['Action'],
                coverImage: { large: 'https://example.com/cover.jpg' },
              }],
            },
          },
        }),
        headers: new Headers(),
      };
    },
  });
  const result = await client.searchAnime('fallback');
  const normalized = result.data[0];

  assert.equal(capturedBody.variables.search, 'fallback');
  assert.equal(normalized.title, 'Fallback title');
  assert.equal(normalized.score, 8.4);
  assert.equal(normalized.source, 'anilist');
  assert.equal(normalized.synopsis, 'A \n synopsis.');
  assert.deepEqual(normalizeMedia({ id: 1, title: { romaji: 'R' } }).title, 'R');
});

test('anime search falls back when Jikan is unavailable', async () => {
  const result = await searchAnimeWithFallback({
    jikanClient: {
      searchAnime: async () => {
        throw new JikanError('gateway timeout', { code: 'UPSTREAM', status: 504 });
      },
    },
    query: 'Frieren',
    fallbackClient: {
      searchAnime: async (query, options) => ({
        source: 'anilist',
        data: [{ mal_id: 52991, title: query, source: 'anilist' }],
        pagination: { currentPage: options.page },
      }),
    },
  });

  assert.equal(result.source, 'anilist');
  assert.equal(result.data[0].title, 'Frieren');
});

test('season selection follows calendar quarters and weather codes have labels', () => {
  assert.equal(currentSeason(new Date('2026-01-12T00:00:00Z')), 'winter');
  assert.equal(currentSeason(new Date('2026-05-12T00:00:00Z')), 'spring');
  assert.equal(currentSeason(new Date('2026-08-12T00:00:00Z')), 'summer');
  assert.equal(currentSeason(new Date('2026-11-12T00:00:00Z')), 'fall');
  assert.deepEqual(getWeatherLabel(61), ['Light rain', '🌦️']);
});

test('Open-Meteo client geocodes a place and requests current plus daily forecast data', async () => {
  const requests = [];
  const client = createOpenMeteoClient({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.hostname.startsWith('geocoding')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ latitude: -6.2, longitude: 106.8, name: 'Jakarta', country: 'Indonesia', timezone: 'Asia/Jakarta' }] }),
          headers: new Headers(),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ current: { temperature_2m: 30 }, daily: { time: ['2026-08-12'] } }),
        headers: new Headers(),
      };
    },
  });

  const location = await client.geocodeLocation('Jakarta');
  await client.getForecast({ ...location, days: 3, units: 'celsius' });

  assert.equal(requests[0].searchParams.get('name'), 'Jakarta');
  assert.equal(requests[1].searchParams.get('latitude'), '-6.2');
  assert.equal(requests[1].searchParams.get('forecast_days'), '3');
  assert.match(requests[1].searchParams.get('current'), /weather_code/);
  assert.match(requests[1].searchParams.get('daily'), /temperature_2m_max/);
});
