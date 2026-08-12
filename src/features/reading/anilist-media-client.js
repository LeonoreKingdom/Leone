const ANILIST_API_URL = 'https://graphql.anilist.co';

class AniListMediaError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AniListMediaError';
    this.code = options.code ?? 'ANILIST_ERROR';
    this.status = options.status ?? null;
  }
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<br\s*\/?>(\s*)/gi, '\n$1')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function buildSearchQuery(options = {}) {
  const variableDefinitions = [
    '$search: String',
    '$page: Int!',
    '$perPage: Int!',
    '$sort: [MediaSort]',
  ];
  const argumentsList = [
    'search: $search',
    'type: MANGA',
    'isAdult: false',
    'sort: $sort',
  ];

  if (options.format) {
    variableDefinitions.push('$format: MediaFormat');
    argumentsList.push('format: $format');
  }
  if (options.country) {
    variableDefinitions.push('$country: CountryCode');
    argumentsList.push('countryOfOrigin: $country');
  }
  if (options.genre) {
    variableDefinitions.push('$genres: [String]');
    argumentsList.push('genre_in: $genres');
  }

  return `
  query (${variableDefinitions.join(', ')}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage lastPage hasNextPage }
      media(${argumentsList.join(', ')}) {
        id
        idMal
        siteUrl
        title { romaji english native }
        description(asHtml: false)
        type
        format
        status
        averageScore
        popularity
        genres
        countryOfOrigin
        volumes
        chapters
        startDate { year month day }
        endDate { year month day }
        coverImage { large medium }
      }
    }
  }
`;
}

const DETAILS_QUERY = `
  query ($id: Int!) {
    Media(id: $id, type: MANGA) {
      id
      idMal
      siteUrl
      title { romaji english native }
      description(asHtml: false)
      type
      format
      status
      averageScore
      popularity
      genres
      countryOfOrigin
      volumes
      chapters
      startDate { year month day }
      endDate { year month day }
      coverImage { large medium }
      relations {
        edges {
          relationType
          node {
            id
            siteUrl
            title { romaji english native }
            format
            type
          }
        }
      }
    }
  }
`;

function normalizeDate(date) {
  if (!date || !date.year) return null;
  return [date.year, date.month, date.day].filter(Boolean).join('-');
}

function normalizeMedia(media) {
  const title = media.title?.english || media.title?.romaji || media.title?.native;
  return {
    id: media.id,
    mal_id: media.idMal ?? null,
    url: media.siteUrl ?? `https://anilist.co/manga/${media.id}`,
    title,
    title_english: media.title?.english ?? null,
    title_japanese: media.title?.native ?? null,
    synopsis: stripHtml(media.description),
    type: media.type,
    format: media.format,
    status: media.status,
    score: media.averageScore === null || media.averageScore === undefined ? null : Number(media.averageScore) / 10,
    popularity: media.popularity,
    genres: (media.genres ?? []).map((name) => ({ name })),
    countryOfOrigin: media.countryOfOrigin ?? null,
    volumes: media.volumes ?? null,
    chapters: media.chapters ?? null,
    startDate: normalizeDate(media.startDate),
    endDate: normalizeDate(media.endDate),
    images: {
      jpg: {
        large_image_url: media.coverImage?.large ?? null,
        image_url: media.coverImage?.medium ?? null,
      },
    },
    relations: (media.relations?.edges ?? []).map((edge) => ({
      type: edge.relationType,
      media: normalizeMedia(edge.node),
    })),
    source: 'anilist',
  };
}

function validatePage(page) {
  const value = Number(page ?? 1);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new AniListMediaError('Reading page must be between 1 and 500.', { code: 'INVALID_REQUEST' });
  }
  return value;
}

function createAniListMediaClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new AniListMediaError('This Node.js runtime does not provide fetch.', { code: 'CONFIGURATION' });
  }

  async function request(query, variables) {
    let response;
    try {
      response = await fetchImpl(ANILIST_API_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'Leone Discord Bot',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new AniListMediaError('AniList request timed out.', { code: 'TIMEOUT' });
      }
      throw new AniListMediaError('AniList could not be reached.', { code: 'UNAVAILABLE' });
    }
    if (response.status === 429) throw new AniListMediaError('AniList rate limit reached.', { code: 'RATE_LIMIT', status: 429 });
    if (!response.ok) throw new AniListMediaError(`AniList returned HTTP ${response.status}.`, { code: 'UPSTREAM', status: response.status });
    let payload;
    try { payload = await response.json(); } catch { throw new AniListMediaError('AniList returned invalid JSON.', { code: 'INVALID_RESPONSE', status: response.status }); }
    if (payload.errors?.length) throw new AniListMediaError('AniList returned a GraphQL error.', { code: 'UPSTREAM', status: response.status });
    return payload.data;
  }

  return {
    searchMedia(query = '', options = {}) {
      const variables = {
        search: String(query).trim() || null,
        page: validatePage(options.page),
        perPage: Math.min(20, Number(options.perPage ?? 10)),
        sort: [options.sort ?? 'SEARCH_MATCH'],
      };
      if (options.format) variables.format = options.format;
      if (options.country) variables.country = options.country;
      if (options.genre) variables.genres = [options.genre];
      return request(buildSearchQuery(options), variables).then((data) => ({
        data: (data.Page.media ?? []).map(normalizeMedia),
        pagination: data.Page.pageInfo,
        source: 'anilist',
      }));
    },
    listMedia(options = {}) {
      return this.searchMedia('', options);
    },
    getMediaDetails(id) {
      if (!/^\d+$/.test(String(id))) {
        throw new AniListMediaError('Reading ID must be a positive integer.', { code: 'INVALID_REQUEST' });
      }
      return request(DETAILS_QUERY, { id: Number(id) }).then((data) => {
        if (!data.Media) throw new AniListMediaError('AniList did not return that title.', { code: 'INVALID_REQUEST' });
        return normalizeMedia(data.Media);
      });
    },
  };
}

module.exports = {
  ANILIST_API_URL,
  AniListMediaError,
  buildSearchQuery,
  createAniListMediaClient,
  normalizeMedia,
  stripHtml,
};
