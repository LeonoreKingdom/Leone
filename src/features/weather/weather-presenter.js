const { EmbedBuilder } = require('discord.js');

const WEATHER_COLOR = 0x4f9bd4;
const OPEN_METEO_URL = 'https://open-meteo.com/';

const WEATHER_CODES = {
  0: ['Clear sky', '☀️'],
  1: ['Mainly clear', '🌤️'],
  2: ['Partly cloudy', '⛅'],
  3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'],
  48: ['Depositing rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'],
  53: ['Moderate drizzle', '🌦️'],
  55: ['Dense drizzle', '🌧️'],
  56: ['Light freezing drizzle', '🌧️'],
  57: ['Dense freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'],
  63: ['Moderate rain', '🌧️'],
  65: ['Heavy rain', '🌧️'],
  66: ['Light freezing rain', '🌧️'],
  67: ['Heavy freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'],
  73: ['Moderate snow', '❄️'],
  75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '❄️'],
  80: ['Light rain showers', '🌦️'],
  81: ['Moderate rain showers', '🌧️'],
  82: ['Violent rain showers', '⛈️'],
  85: ['Light snow showers', '🌨️'],
  86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'],
  96: ['Thunderstorm with light hail', '⛈️'],
  99: ['Thunderstorm with heavy hail', '⛈️'],
};

function getWeatherLabel(code) {
  return WEATHER_CODES[Number(code)] ?? ['Unknown conditions', '🌡️'];
}

function formatLocation(location) {
  return [location.name, location.admin1, location.country]
    .filter(Boolean)
    .join(', ');
}

function formatTemperature(value, units) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(0)}°${units === 'fahrenheit' ? 'F' : 'C'}`;
}

function createCurrentEmbed(location, forecast, units) {
  const current = forecast.current ?? {};
  const [description, emoji] = getWeatherLabel(current.weather_code);
  const unitLabel = units === 'fahrenheit' ? 'F' : 'C';

  return new EmbedBuilder()
    .setColor(WEATHER_COLOR)
    .setAuthor({ name: 'Weather data from Open-Meteo', url: OPEN_METEO_URL })
    .setTitle(`${emoji} Current weather — ${location.name}`)
    .setDescription(`${description} in ${formatLocation(location)}.`)
    .addFields(
      { name: 'Temperature', value: formatTemperature(current.temperature_2m, units), inline: true },
      { name: 'Feels like', value: formatTemperature(current.apparent_temperature, units), inline: true },
      { name: 'Humidity', value: Number.isFinite(Number(current.relative_humidity_2m)) ? `${current.relative_humidity_2m}%` : '—', inline: true },
      { name: 'Precipitation', value: Number.isFinite(Number(current.precipitation)) ? `${current.precipitation} mm` : '—', inline: true },
      { name: 'Wind', value: Number.isFinite(Number(current.wind_speed_10m)) ? `${current.wind_speed_10m} km/h` : '—', inline: true },
      { name: 'Units', value: `Temperature: °${unitLabel}`, inline: true },
    )
    .setFooter({ text: 'Forecast model data; check local authorities for severe-weather decisions.' });
}

function createForecastEmbed(location, forecast, units) {
  const daily = forecast.daily ?? {};
  const dates = daily.time ?? [];
  const fields = dates.slice(0, 7).map((date, index) => {
    const [description, emoji] = getWeatherLabel(daily.weather_code?.[index]);
    const rainChance = daily.precipitation_probability_max?.[index];
    const rainText = Number.isFinite(Number(rainChance)) ? ` • Rain ${rainChance}%` : '';
    return {
      name: `${emoji} ${date}`,
      value: `${description}\n${formatTemperature(daily.temperature_2m_min?.[index], units)} – ${formatTemperature(daily.temperature_2m_max?.[index], units)}${rainText}`,
      inline: true,
    };
  });

  return new EmbedBuilder()
    .setColor(WEATHER_COLOR)
    .setAuthor({ name: 'Weather data from Open-Meteo', url: OPEN_METEO_URL })
    .setTitle(`🌤️ Forecast — ${location.name}`)
    .setDescription(formatLocation(location))
    .addFields(fields.length ? fields : [{ name: 'Forecast', value: 'No forecast days were returned.' }])
    .setFooter({ text: 'Forecast model data; check local authorities for severe-weather decisions.' });
}

module.exports = {
  WEATHER_CODES,
  createCurrentEmbed,
  createForecastEmbed,
  formatLocation,
  formatTemperature,
  getWeatherLabel,
};
