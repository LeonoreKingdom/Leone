const GENRES = {
  action: { id: 28, label: 'Action' },
  adventure: { id: 12, label: 'Adventure' },
  animation: { id: 16, label: 'Animation' },
  comedy: { id: 35, label: 'Comedy' },
  crime: { id: 80, label: 'Crime' },
  documentary: { id: 99, label: 'Documentary' },
  drama: { id: 18, label: 'Drama' },
  family: { id: 10751, label: 'Family' },
  fantasy: { id: 14, label: 'Fantasy' },
  history: { id: 36, label: 'History' },
  horror: { id: 27, label: 'Horror' },
  music: { id: 10402, label: 'Music' },
  mystery: { id: 9648, label: 'Mystery' },
  romance: { id: 10749, label: 'Romance' },
  science_fiction: {
    id: 878,
    label: 'Science Fiction',
  },
  thriller: { id: 53, label: 'Thriller' },
  war: { id: 10752, label: 'War' },
  western: { id: 37, label: 'Western' },
};

const GENRES_BY_ID = new Map(
  Object.values(GENRES).map((genre) => [
    genre.id,
    genre.label,
  ]),
);

const MOODS = {
  feel_good: {
    label: 'Feel-good',
    genreIds: [35, 10751, 10749, 16],
  },
  exciting: {
    label: 'Exciting',
    genreIds: [28, 12, 878],
  },
  funny: {
    label: 'Funny',
    genreIds: [35],
  },
  romantic: {
    label: 'Romantic',
    genreIds: [10749, 35, 18],
  },
  scary: {
    label: 'Scary',
    genreIds: [27, 53, 9648],
  },
  thoughtful: {
    label: 'Thoughtful',
    genreIds: [18, 99, 878, 9648],
  },
};

const RUNTIMES = {
  short: {
    label: 'Short (up to 90 minutes)',
    query: { 'with_runtime.lte': 90 },
  },
  standard: {
    label: 'Standard (91–120 minutes)',
    query: {
      'with_runtime.gte': 91,
      'with_runtime.lte': 120,
    },
  },
  long: {
    label: 'Long (over 120 minutes)',
    query: { 'with_runtime.gte': 121 },
  },
};

const ERAS = {
  recent: {
    label: 'Recent (last five years)',
    getQuery(year) {
      return {
        'primary_release_date.gte': `${year - 4}-01-01`,
        'primary_release_date.lte': `${year}-12-31`,
      };
    },
  },
  twenty_twenties: {
    label: '2020s',
    getQuery() {
      return {
        'primary_release_date.gte': '2020-01-01',
        'primary_release_date.lte': '2029-12-31',
      };
    },
  },
  modern: {
    label: 'Modern (2000–2019)',
    getQuery() {
      return {
        'primary_release_date.gte': '2000-01-01',
        'primary_release_date.lte': '2019-12-31',
      };
    },
  },
  classic: {
    label: 'Classic (before 2000)',
    getQuery() {
      return {
        'primary_release_date.lte': '1999-12-31',
      };
    },
  },
};

function buildDiscoverQuery(
  preferences,
  currentYear = new Date().getUTCFullYear(),
) {
  const genre = GENRES[preferences.genre] ?? null;
  const mood = MOODS[preferences.mood] ?? null;
  const runtime = RUNTIMES[preferences.runtime] ?? null;
  const era = ERAS[preferences.era] ?? null;
  const minimumRating =
    preferences.minimumRating ?? 6;
  const query = {
    include_adult: false,
    include_video: false,
    language: preferences.locale ?? 'en-US',
    page: 1,
    sort_by: 'popularity.desc',
    'vote_average.gte': minimumRating,
    'vote_count.gte': 100,
  };

  if (genre) {
    query.with_genres = genre.id;
  } else if (mood) {
    query.with_genres = mood.genreIds.join('|');
  }

  if (runtime) {
    Object.assign(query, runtime.query);
  }

  if (era) {
    Object.assign(query, era.getQuery(currentYear));
  }

  if (preferences.originalLanguage) {
    query.with_original_language =
      preferences.originalLanguage;
  }

  return query;
}

function scoreMovie(movie, preferences) {
  const genre = GENRES[preferences.genre] ?? null;
  const mood = MOODS[preferences.mood] ?? null;
  const movieGenreIds = new Set(movie.genre_ids ?? []);
  let score =
    Number(movie.vote_average ?? 0) +
    Math.log10(
      Math.max(1, Number(movie.popularity ?? 0)),
    );

  if (genre && movieGenreIds.has(genre.id)) {
    score += 4;
  }

  if (mood) {
    score +=
      mood.genreIds.filter((id) => movieGenreIds.has(id))
        .length * 2;
  }

  return score;
}

function selectMovies(results, preferences, limit = 3) {
  return results
    .filter(
      (movie) =>
        movie &&
        !movie.adult &&
        movie.id &&
        movie.title &&
        movie.release_date,
    )
    .sort(
      (left, right) =>
        scoreMovie(right, preferences) -
        scoreMovie(left, preferences),
    )
    .slice(0, limit);
}

function getMovieGenreLabels(movie) {
  return (movie.genre_ids ?? [])
    .map((id) => GENRES_BY_ID.get(id))
    .filter(Boolean);
}

function describeMatch(movie, preferences) {
  const reasons = [];
  const genre = GENRES[preferences.genre] ?? null;
  const mood = MOODS[preferences.mood] ?? null;

  if (genre) {
    reasons.push(`matches your **${genre.label}** choice`);
  }

  if (mood) {
    const moodMatches = mood.genreIds.filter((id) =>
      (movie.genre_ids ?? []).includes(id),
    );

    reasons.push(
      moodMatches.length > 0
        ? `fits a **${mood.label.toLowerCase()}** mood`
        : `was ranked for your **${mood.label.toLowerCase()}** mood`,
    );
  }

  if (RUNTIMES[preferences.runtime]) {
    reasons.push(
      `fits the **${RUNTIMES[
        preferences.runtime
      ].label.toLowerCase()}** range`,
    );
  }

  if (ERAS[preferences.era]) {
    reasons.push(
      `comes from your **${ERAS[
        preferences.era
      ].label.toLowerCase()}** era`,
    );
  }

  if (preferences.originalLanguage) {
    reasons.push(
      `uses your selected original language (**${preferences.originalLanguage}**)`,
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      'is a well-rated, popular pick from the current catalog',
    );
  }

  return `It ${reasons.join(', ')}.`;
}

module.exports = {
  ERAS,
  GENRES,
  GENRES_BY_ID,
  MOODS,
  RUNTIMES,
  buildDiscoverQuery,
  describeMatch,
  getMovieGenreLabels,
  scoreMovie,
  selectMovies,
};
