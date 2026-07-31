const QUOTES = [
  {
    text: 'Small steps still move you closer to your dreams.',
    author: 'Leone',
  },
  {
    text: 'You are allowed to grow gently and still be proud of your progress.',
    author: 'Leone',
  },
  {
    text: 'Your pace does not make your journey any less meaningful.',
    author: 'Leone',
  },
  {
    text: 'Rest is not giving up; sometimes it is how courage gathers strength.',
    author: 'Leone',
  },
  {
    text: 'One kind choice can make the whole Kingdom feel a little warmer.',
    author: 'Leone',
  },
  {
    text: 'You do not need a perfect plan to take one hopeful step.',
    author: 'Leone',
  },
  {
    text: 'The dreams you protect today may become the life you celebrate tomorrow.',
    author: 'Leone',
  },
  {
    text: 'Even a quiet day can hold meaningful progress.',
    author: 'Leone',
  },
  {
    text: 'Be patient with the person you are becoming.',
    author: 'Leone',
  },
  {
    text: 'Your talent shines brightest when you give it room to grow.',
    author: 'Leone',
  },
  {
    text: 'A difficult morning does not get to decide your whole day.',
    author: 'Leone',
  },
  {
    text: 'There is strength in asking for help and kindness in offering it.',
    author: 'Leone',
  },
  {
    text: 'Celebrate the progress that nobody else can see yet.',
    author: 'Leone',
  },
  {
    text: 'You belong here while learning, resting, trying, and becoming.',
    author: 'Leone',
  },
];

const QUOTE_POOLS = {
  rainy: [QUOTES[3], QUOTES[10], QUOTES[11], QUOTES[13]],
  bright: [
    QUOTES[0],
    QUOTES[5],
    QUOTES[6],
    QUOTES[9],
    QUOTES[12],
  ],
  calm: [QUOTES[1], QUOTES[2], QUOTES[7], QUOTES[8]],
};

function getJakartaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function hashText(value) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }

  return hash;
}

function selectDailyQuote(
  date = new Date(),
  weatherDescription = '',
) {
  const dateKey = getJakartaDate(date);
  const mood =
    getWeatherPresentation(weatherDescription).mood;
  const quotePool = QUOTE_POOLS[mood] ?? QUOTES;

  return quotePool[hashText(dateKey) % quotePool.length];
}

function getWeatherPresentation(description = '') {
  const normalized = description.toLowerCase();

  if (
    normalized.includes('hujan') ||
    normalized.includes('rain') ||
    normalized.includes('petir') ||
    normalized.includes('thunder')
  ) {
    return {
      mood: 'rainy',
      emoji: '☔',
      advice:
        'Jangan lupa payung dan take care on your way out.',
    };
  }

  if (
    normalized.includes('cerah') ||
    normalized.includes('clear') ||
    normalized.includes('sunny')
  ) {
    return {
      mood: 'bright',
      emoji: '☀️',
      advice:
        'Let that bright sky bring a little energy into your day.',
    };
  }

  if (
    normalized.includes('berawan') ||
    normalized.includes('cloud')
  ) {
    return {
      mood: 'calm',
      emoji: '☁️',
      advice:
        'A calm morning can still become a beautiful day.',
    };
  }

  return {
    mood: 'general',
    emoji: '🌤️',
    advice:
      'Whatever the sky looks like today, let us begin gently.',
  };
}

function buildMorningMessage(options = {}) {
  const roleMention = options.roleMention ?? '@Citizen';
  const weather = options.weather ?? null;
  const quote =
    options.quote ??
    selectDailyQuote(options.date, weather?.description);
  const location =
    options.locationLabel ?? weather?.location ?? null;
  const lines = [
    `Selamat pagi, ${roleMention}! Good morning, Citizens 👑`,
    '',
  ];

  if (weather) {
    const presentation = getWeatherPresentation(
      weather.description,
    );
    const temperature =
      weather.temperature === null ||
      weather.temperature === undefined
        ? ''
        : `, sekitar **${weather.temperature}°C**`;

    lines.push(
      `${presentation.emoji} **Pagi ini di ${
        location || 'lokasi pilihan Kingdom'
      }:** ${weather.description}${temperature}. ${presentation.advice}`,
      '',
    );
  } else {
    lines.push(
      '🌤️ Whatever the sky looks like today, let us begin gently.',
      '',
    );
  }

  lines.push(
    '✨ **Today’s royal reminder**',
    '',
    `“${quote.text}” — **${quote.author}**`,
    '',
    'Apa pun yang kamu jalani hari ini—belajar, bekerja, berkarya, beristirahat, atau push rank—take it one gentle step at a time. You do not need to have everything figured out today.',
    '',
    'May your morning feel soft, your heart feel lighter, and every small step bring you closer to the dreams you are building. Leone is rooting for you. 💙',
    '',
    '**WE BELONG TOGETHER.**',
  );

  if (weather) {
    lines.push('', '*Weather data: BMKG*');
  }

  return lines.join('\n');
}

module.exports = {
  QUOTES,
  QUOTE_POOLS,
  buildMorningMessage,
  getJakartaDate,
  getWeatherPresentation,
  hashText,
  selectDailyQuote,
};
