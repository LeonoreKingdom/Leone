const areas = {
  kingdom: {
    id: 'kingdom',
    label: 'Kingdom',
    emoji: '🏰',
    description:
      'Identity, leadership, rules, server information, and navigation.',
    order: 10,
  },
  relationships: {
    id: 'relationships',
    label: 'Relationships',
    emoji: '🤝',
    description:
      'Consent-based social bonds, privacy, blocking, and data controls.',
    order: 20,
  },
  recommendations: {
    id: 'recommendations',
    label: 'Recommendations',
    emoji: '🎬',
    description:
      'Personalized movie, anime, series, and reading discoveries.',
    order: 30,
  },
  movies: {
    id: 'movies',
    label: 'Movies',
    emoji: '\u{1F3AC}',
    description:
      'Browse, search, inspect, and discover movies from TMDB.',
    order: 35,
  },
  anime: {
    id: 'anime',
    label: 'Anime',
    emoji: '\u{1F38C}',
    description:
      'Browse, search, recommend, and explore anime seasons.',
    order: 37,
  },
  series: {
    id: 'series',
    label: 'Series',
    emoji: '\u{1F4FA}',
    description:
      'Browse, search, recommend, and explore TV and streaming series.',
    order: 38,
  },
  reading: {
    id: 'reading',
    label: 'Reading',
    emoji: '\u{1F4DA}',
    description:
      'Explore novels, manga, manhwa, and manhua through AniList.',
    order: 39,
  },
  automation: {
    id: 'automation',
    label: 'Automation',
    emoji: '☀️',
    description:
      'Staff-controlled greetings and community routines.',
    order: 45,
  },
  weather: {
    id: 'weather',
    label: 'Weather',
    emoji: '\u{1F324}',
    description:
      'Live conditions and forecasts for places around the world.',
    order: 50,
  },
  utility: {
    id: 'utility',
    label: 'Utilities',
    emoji: '⚙️',
    description: 'Leone help and service-status tools.',
    order: 90,
  },
};

module.exports = {
  areas,
};
