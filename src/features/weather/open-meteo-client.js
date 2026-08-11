const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

class OpenMeteoError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'OpenMeteoError';
    this.code = options.code ?? 'OPEN_METEO_ERROR';
    this.status = options.status ?? null;
  }
}

function createOpenMeteoClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new OpenMeteoError('This Node.js runtime does not provide fetch.', {
      code: 'CONFIGURATION',
    });
  }

  async function fetchJson(url) {
    let response;

    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Leone Discord Bot',
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new OpenMeteoError('Open-Meteo request timed out.', {
          code: 'TIMEOUT',
        });
      }

      throw new OpenMeteoError('Open-Meteo could not be reached.', {
        code: 'UNAVAILABLE',
      });
    }

    if (!response.ok) {
      throw new OpenMeteoError(`Open-Meteo returned HTTP ${response.status}.`, {
        code: 'UPSTREAM',
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch {
      throw new OpenMeteoError('Open-Meteo returned invalid JSON.', {
        code: 'INVALID_RESPONSE',
        status: response.status,
      });
    }
  }

  async function geocodeLocation(name) {
    const query = String(name ?? '').trim();
    if (!query) {
      throw new OpenMeteoError('Weather location is required.', {
        code: 'INVALID_LOCATION',
      });
    }

    const url = new URL(OPEN_METEO_GEOCODING_URL);
    url.searchParams.set('name', query);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const payload = await fetchJson(url);
    const location = payload.results?.[0];

    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) {
      throw new OpenMeteoError(`I could not find a weather location for “${query}”.`, {
        code: 'LOCATION_NOT_FOUND',
      });
    }

    return {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      name: location.name,
      admin1: location.admin1 ?? null,
      country: location.country ?? null,
      timezone: location.timezone ?? 'auto',
    };
  }

  async function getForecast({ latitude, longitude, days = 5, units = 'celsius', timezone = 'auto' }) {
    const numericLatitude = Number(latitude);
    const numericLongitude = Number(longitude);
    const forecastDays = Number(days);

    if (
      !Number.isFinite(numericLatitude) ||
      !Number.isFinite(numericLongitude) ||
      !Number.isInteger(forecastDays) ||
      forecastDays < 1 ||
      forecastDays > 7 ||
      !['celsius', 'fahrenheit'].includes(units)
    ) {
      throw new OpenMeteoError('Weather forecast options are not valid.', {
        code: 'INVALID_REQUEST',
      });
    }

    const url = new URL(OPEN_METEO_FORECAST_URL);
    url.searchParams.set('latitude', String(numericLatitude));
    url.searchParams.set('longitude', String(numericLongitude));
    url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
    url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset');
    url.searchParams.set('forecast_days', String(forecastDays));
    url.searchParams.set('temperature_unit', units);
    url.searchParams.set('timezone', timezone || 'auto');
    return fetchJson(url);
  }

  return {
    geocodeLocation,
    getForecast,
  };
}

module.exports = {
  OPEN_METEO_FORECAST_URL,
  OPEN_METEO_GEOCODING_URL,
  OpenMeteoError,
  createOpenMeteoClient,
};
