const {
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const {
  createOpenMeteoClient,
  OpenMeteoError,
} = require('./open-meteo-client');
const {
  createCurrentEmbed,
  createForecastEmbed,
} = require('./weather-presenter');

const data = new SlashCommandBuilder()
  .setName('weather')
  .setDescription('Check current weather and forecasts worldwide.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('current')
      .setDescription('Show current weather for a city or place.')
      .addStringOption((option) =>
        option
          .setName('location')
          .setDescription('City, district, or place name.')
          .setMinLength(2)
          .setMaxLength(100)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('units')
          .setDescription('Temperature unit.')
          .addChoices(
            { name: 'Celsius', value: 'celsius' },
            { name: 'Fahrenheit', value: 'fahrenheit' },
          ),
      )
      .addBooleanOption((option) =>
        option.setName('private').setDescription('Show the result only to you.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('forecast')
      .setDescription('Show a multi-day weather forecast.')
      .addStringOption((option) =>
        option
          .setName('location')
          .setDescription('City, district, or place name.')
          .setMinLength(2)
          .setMaxLength(100)
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('days')
          .setDescription('Number of days, from 1 to 7.')
          .setMinValue(1)
          .setMaxValue(7),
      )
      .addStringOption((option) =>
        option
          .setName('units')
          .setDescription('Temperature unit.')
          .addChoices(
            { name: 'Celsius', value: 'celsius' },
            { name: 'Fahrenheit', value: 'fahrenheit' },
          ),
      )
      .addBooleanOption((option) =>
        option.setName('private').setDescription('Show the result only to you.'),
      ),
  );

const help = {
  area: 'weather',
  usage: '/weather <current|forecast> location:<place>',
  summary: 'Check live conditions and short forecasts with Open-Meteo.',
  audience: 'everyone',
  order: 10,
};

function getFriendlyError(error) {
  if (!(error instanceof OpenMeteoError)) return null;
  switch (error.code) {
    case 'LOCATION_NOT_FOUND':
      return error.message;
    case 'INVALID_LOCATION':
    case 'INVALID_REQUEST':
      return 'Please provide a valid location and forecast range.';
    case 'TIMEOUT':
    case 'UNAVAILABLE':
    case 'UPSTREAM':
    case 'INVALID_RESPONSE':
      return 'The weather service is temporarily unavailable. Please try again later.';
    default:
      return null;
  }
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const isPrivate = interaction.options.getBoolean('private') ?? false;
  const units = interaction.options.getString('units') ?? 'celsius';
  await interaction.deferReply(
    isPrivate ? { flags: MessageFlags.Ephemeral } : undefined,
  );

  try {
    const client = createOpenMeteoClient();
    const location = await client.geocodeLocation(
      interaction.options.getString('location', true),
    );
    const days = subcommand === 'forecast'
      ? interaction.options.getInteger('days') ?? 5
      : 1;
    const forecast = await client.getForecast({
      latitude: location.latitude,
      longitude: location.longitude,
      days,
      units,
      timezone: location.timezone,
    });
    const embed = subcommand === 'current'
      ? createCurrentEmbed(location, forecast, units)
      : createForecastEmbed(location, forecast, units);

    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const friendlyError = getFriendlyError(error);
    if (!friendlyError) throw error;
    await interaction.editReply({ content: friendlyError });
  }
}

module.exports = {
  data,
  execute,
  getFriendlyError,
  help,
};
