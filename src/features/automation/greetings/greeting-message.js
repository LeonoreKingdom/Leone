const {
  QUOTES,
  getJakartaDate,
  getWeatherPresentation,
  hashText,
} = require('../morning/morning-message');

const OCCASIONS = ['morning', 'afternoon', 'evening', 'night', 'custom'];

const OCCASION_COPY = {
  morning: {
    id: 'Selamat pagi',
    en: 'Good morning',
    emoji: '🌅',
    wish: 'May your morning feel gentle and your first steps feel possible.',
  },
  afternoon: {
    id: 'Selamat siang',
    en: 'Good afternoon',
    emoji: '☀️',
    wish: 'May your afternoon bring renewed energy and a little room to breathe.',
  },
  evening: {
    id: 'Selamat sore',
    en: 'Good evening',
    emoji: '🌇',
    wish: 'May your evening hold warmth, good company, and pride in today’s progress.',
  },
  night: {
    id: 'Selamat malam',
    en: 'Good night',
    emoji: '🌙',
    wish: 'May tonight give you rest, comfort, and strength for what comes next.',
  },
  custom: {
    id: 'Salam hangat',
    en: 'Warm greetings',
    emoji: '👑',
    wish: 'Wherever you are today, the Kingdom is rooting for your next gentle step.',
  },
};

function selectGreetingQuote(date = new Date(), occasion = 'custom', weather = '') {
  const key = `${getJakartaDate(date)}:${occasion}:${weather}`;
  return QUOTES[hashText(key) % QUOTES.length];
}

function buildGreetingMessage(options = {}) {
  const occasion = OCCASIONS.includes(options.occasion)
    ? options.occasion
    : 'custom';
  const copy = OCCASION_COPY[occasion];
  const roleMention = options.roleMention ?? '@Citizen';
  const weather = options.weather ?? null;
  const quote =
    options.quote ??
    selectGreetingQuote(
      options.date,
      occasion,
      weather?.description ?? '',
    );
  const location = options.locationLabel ?? weather?.location ?? null;
  const lines = [
    `${copy.id}, ${roleMention}! ${copy.en}, Citizens ${copy.emoji}`,
    '',
  ];

  if (weather) {
    const presentation = getWeatherPresentation(weather.description);
    const temperature =
      weather.temperature === null || weather.temperature === undefined
        ? ''
        : `, sekitar **${weather.temperature}°C**`;

    lines.push(
      `${presentation.emoji} **Cuaca di ${
        location || 'lokasi pilihan Kingdom'
      }:** ${weather.description}${temperature}. ${presentation.advice}`,
      '',
    );
  }

  lines.push(
    '✨ **Royal reminder**',
    '',
    `“${quote.text}” — **${quote.author}**`,
    '',
    'Apa pun yang sedang kamu jalani—belajar, bekerja, berkarya, beristirahat, atau push rank—take it one gentle step at a time.',
    '',
    `${copy.wish} Leone is rooting for you. 💙`,
    '',
    '**WE BELONG TOGETHER.**',
  );

  if (weather) {
    lines.push('', '*Weather data: BMKG*');
  }

  return lines.join('\n');
}

module.exports = {
  OCCASIONS,
  OCCASION_COPY,
  buildGreetingMessage,
  selectGreetingQuote,
};
