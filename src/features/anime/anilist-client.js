const ANILIST_API_URL = 'https://graphql.anilist.co';

const ANILIST_MEDIA_FIELDS = `
      media(search: $search, type: ANIME, isAdult: false, SORT_ARGUMENTS) {
        id
        idMal
        siteUrl
        title { romaji english native }
        description(asHtml: false)
        type
        episodes
        status
        averageScore
        popularity
        genres
        coverImage { large medium }
      }
`;

function buildAniListSearchQuery(options = {}) {
  const variableDefinitions = [
    '$search: String',
    '$page: Int',
    '$perPage: Int',
    '$sort: [MediaSort]',
  ];
  const sortArguments = ['sort: $sort'];

  if (options.hasGenre) {
    variableDefinitions.push('$genres: [String]');
    sortArguments.push('genre_in: $genres');
  }

  if (options.hasFormat) {
    variableDefinitions.push('$format: MediaFormat');
    sortArguments.push('format: $format');
  }

  return `
  query (${variableDefinitions.join(', ')}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage lastPage hasNextPage }
${ANILIST_MEDIA_FIELDS.replace('SORT_ARGUMENTS', sortArguments.join(', '))}
    }
  }
`;
}

class AniListError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AniListError';
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

function normalizeMedia(media) {
  const title = media.title?.english || media.title?.romaji || media.title?.native;
  const malId = media.idMal ?? media.id;
  return {
    mal_id: malId,
    url: media.siteUrl ?? `https://anilist.co/anime/${media.id}`,
    title,
    title_english: media.title?.english ?? null,
    title_japanese: media.title?.native ?? null,
    synopsis: stripHtml(media.description),
    type: media.type,
    episodes: media.episodes,
    status: media.status,
    score: media.averageScore === null || media.averageScore === undefined
      ? null
      : Number(media.averageScore) / 10,
    popularity: media.popularity,
    genres: (media.genres ?? []).map((name) => ({ name })),
    images: {
      jpg: {
        large_image_url: media.coverImage?.large ?? null,
        image_url: media.coverImage?.medium ?? null,
      },
    },
    source: 'anilist',
  };
}

function createAniListClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new AniListError('This Node.js runtime does not provide fetch.', {
      code: 'CONFIGURATION',
    });
  }

  async function searchAnime(query = '', options = {}) {
    const variables = {
      search: String(query).trim() || null,
      page: Number(options.page ?? 1),
      perPage: Math.min(5, Number(options.perPage ?? 5)),
      sort: [options.sort ?? 'SEARCH_MATCH'],
    };
    if (options.genre) variables.genres = [options.genre];
    if (options.format) variables.format = String(options.format).toUpperCase();
    const queryDocument = buildAniListSearchQuery({
      hasGenre: Boolean(options.genre),
      hasFormat: Boolean(options.format),
    });
    const response = await fetchImpl(ANILIST_API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'Leone Discord Bot',
      },
      body: JSON.stringify({ query: queryDocument, variables }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new AniListError(`AniList returned HTTP ${response.status}.`, {
        code: response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM',
        status: response.status,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new AniListError('AniList returned invalid JSON.', {
        code: 'INVALID_RESPONSE',
        status: response.status,
      });
    }

    if (payload.errors?.length || !payload.data?.Page) {
      throw new AniListError('AniList returned a GraphQL error.', {
        code: 'UPSTREAM',
        status: response.status,
      });
    }

    const page = payload.data.Page;
    return {
      data: (page.media ?? []).map(normalizeMedia),
      pagination: page.pageInfo,
      source: 'anilist',
    };
  }

  return { searchAnime };
}

module.exports = {
  ANILIST_API_URL,
  AniListError,
  buildAniListSearchQuery,
  createAniListClient,
  normalizeMedia,
  stripHtml,
};
