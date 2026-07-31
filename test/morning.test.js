const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BmkgError,
  createBmkgClient,
  selectClosestForecast,
} = require('../src/features/automation/morning/bmkg-client');
const {
  QUOTE_POOLS,
  buildMorningMessage,
  getWeatherPresentation,
  selectDailyQuote,
} = require('../src/features/automation/morning/morning-message');
const {
  executeMorning,
} = require('../src/features/automation/morning/morning.command');

test('daily morning quote is stable for the Jakarta date', () => {
  const date = new Date('2026-07-31T00:00:00.000Z');

  assert.deepEqual(
    selectDailyQuote(date),
    selectDailyQuote(date),
  );

  assert.ok(
    QUOTE_POOLS.rainy.includes(
      selectDailyQuote(date, 'Hujan Ringan'),
    ),
  );
  assert.ok(
    QUOTE_POOLS.bright.includes(
      selectDailyQuote(date, 'Cerah'),
    ),
  );
});

test('morning message adapts to rain and attributes BMKG', () => {
  const message = buildMorningMessage({
    date: new Date('2026-07-31T00:00:00.000Z'),
    roleMention: '<@&citizen-1>',
    weather: {
      description: 'Hujan Ringan',
      location: 'Kemayoran, Jakarta Pusat',
      temperature: 27,
    },
  });

  assert.match(message, /<@&citizen-1>/);
  assert.match(message, /Hujan Ringan/);
  assert.match(message, /27°C/);
  assert.match(message, /payung/);
  assert.match(message, /Weather data: BMKG/);
  assert.ok(message.length <= 2000);
});

test('morning message has a weather-neutral fallback', () => {
  const message = buildMorningMessage({
    roleMention: '<@&citizen-1>',
  });

  assert.match(message, /Whatever the sky looks like/);
  assert.doesNotMatch(message, /Weather data: BMKG/);
  assert.equal(
    getWeatherPresentation('Cerah').emoji,
    '☀️',
  );
});

test('BMKG client normalizes nested forecast data', async () => {
  let requestedUrl;
  const client = createBmkgClient({
    now: () => Date.parse('2026-07-31T00:30:00.000Z'),
    fetchImpl: async (url) => {
      requestedUrl = url;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          lokasi: {
            desa: 'Kemayoran',
            kotkab: 'Jakarta Pusat',
          },
          data: [
            {
              cuaca: [
                [
                  {
                    utc_datetime: '2026-07-31 00:00:00',
                    local_datetime: '2026-07-31 07:00:00',
                    t: 26,
                    hu: 80,
                    ws: 4,
                    weather_desc: 'Berawan',
                  },
                  {
                    utc_datetime: '2026-07-31 03:00:00',
                    local_datetime: '2026-07-31 10:00:00',
                    t: 29,
                    hu: 70,
                    ws: 6,
                    weather_desc: 'Cerah Berawan',
                  },
                ],
              ],
            },
          ],
        }),
      };
    },
  });

  const weather = await client.getForecast('31.71.03.1001');

  assert.equal(
    requestedUrl.searchParams.get('adm4'),
    '31.71.03.1001',
  );
  assert.deepEqual(weather, {
    description: 'Cerah Berawan',
    humidity: 70,
    localDateTime: '2026-07-31 10:00:00',
    location: 'Kemayoran, Jakarta Pusat',
    temperature: 29,
    windSpeed: 6,
  });
});

test('BMKG client rejects invalid ADM4 without a request', async () => {
  const client = createBmkgClient({
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    },
  });

  await assert.rejects(
    () => client.getForecast('Jakarta'),
    (error) =>
      error instanceof BmkgError &&
      error.code === 'INVALID_LOCATION',
  );
});

test('closest forecast prefers the next available interval', () => {
  const forecasts = [
    { utc_datetime: '2026-07-31 00:00:00', id: 1 },
    { utc_datetime: '2026-07-31 03:00:00', id: 2 },
  ];

  assert.equal(
    selectClosestForecast(
      forecasts,
      Date.parse('2026-07-31T00:30:00.000Z'),
    ).id,
    2,
  );
});

function createMorningInteraction(subcommand, overrides = {}) {
  let deferredPayload;
  let replyPayload;
  let editPayload;
  let sentPayload;
  const role = {
    id: 'citizen-1',
    mentionable: true,
  };
  const interaction = {
    appPermissions: {
      has: () => false,
    },
    channel: {
      isTextBased: () => true,
      send: async (payload) => {
        sentPayload = payload;

        return {
          url: 'https://discord.com/channels/guild/channel/message',
        };
      },
    },
    guild: {
      id: 'guild-1',
      ownerId: 'owner-1',
    },
    memberPermissions: null,
    options: {
      getRole: () => role,
      getString: () => null,
      getSubcommand: () => subcommand,
    },
    user: {
      id: 'owner-1',
    },
    inGuild: () => true,
    deferReply: async (payload) => {
      deferredPayload = payload;
    },
    editReply: async (payload) => {
      editPayload = payload;
    },
    reply: async (payload) => {
      replyPayload = payload;
    },
    ...overrides,
  };

  return {
    interaction,
    get deferredPayload() {
      return deferredPayload;
    },
    get editPayload() {
      return editPayload;
    },
    get replyPayload() {
      return replyPayload;
    },
    get sentPayload() {
      return sentPayload;
    },
  };
}

test('morning preview is private and never pings the role', async () => {
  const command = createMorningInteraction('preview');

  await executeMorning(command.interaction, {
    date: new Date('2026-07-31T00:00:00.000Z'),
  });

  assert.ok(command.deferredPayload);
  assert.match(command.editPayload.content, /Preview/);
  assert.deepEqual(command.editPayload.allowedMentions, {
    parse: [],
  });
  assert.equal(command.sentPayload, undefined);
});

test('morning send posts separately with one allowed role', async () => {
  const command = createMorningInteraction('send');

  await executeMorning(command.interaction, {
    date: new Date('2026-07-31T00:00:00.000Z'),
  });

  assert.match(command.sentPayload.content, /<@&citizen-1>/);
  assert.deepEqual(command.sentPayload.allowedMentions, {
    roles: ['citizen-1'],
    users: [],
    repliedUser: false,
  });
  assert.match(
    command.editPayload.content,
    /sent successfully/,
  );
});

test('morning command rejects unauthorized members', async () => {
  const command = createMorningInteraction('send', {
    guild: {
      id: 'guild-1',
      ownerId: 'owner-1',
    },
    user: {
      id: 'member-1',
    },
  });

  await executeMorning(command.interaction);

  assert.match(
    command.replyPayload.content,
    /Only the server owner/,
  );
  assert.equal(command.sentPayload, undefined);
});
