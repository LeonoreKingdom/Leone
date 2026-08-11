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
      'Personalized movie, game, and media discoveries.',
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
  automation: {
    id: 'automation',
    label: 'Automation',
    emoji: '☀️',
    description:
      'Staff-controlled greetings and community routines.',
    order: 40,
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
