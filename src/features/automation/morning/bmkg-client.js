const BMKG_API_BASE_URL =
  'https://api.bmkg.go.id/publik/prakiraan-cuaca';
const ADM4_PATTERN = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

class BmkgError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'BmkgError';
    this.code = options.code ?? 'BMKG_ERROR';
    this.status = options.status ?? null;
  }
}

function parseUtcDateTime(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = Date.parse(
    `${value.trim().replace(' ', 'T')}Z`,
  );

  return Number.isNaN(timestamp) ? null : timestamp;
}

function flattenForecasts(payload) {
  const dailyForecasts = payload?.data?.[0]?.cuaca;

  if (!Array.isArray(dailyForecasts)) {
    return [];
  }

  return dailyForecasts
    .flatMap((day) => (Array.isArray(day) ? day : []))
    .filter((forecast) => forecast && typeof forecast === 'object');
}

function selectClosestForecast(forecasts, now = Date.now()) {
  const timedForecasts = forecasts
    .map((forecast) => ({
      forecast,
      timestamp: parseUtcDateTime(forecast.utc_datetime),
    }))
    .filter(({ timestamp }) => timestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (timedForecasts.length === 0) {
    return forecasts[0] ?? null;
  }

  const upcoming = timedForecasts.find(
    ({ timestamp }) => timestamp >= now,
  );

  if (upcoming) {
    return upcoming.forecast;
  }

  return timedForecasts.at(-1).forecast;
}

function formatLocation(location = {}) {
  const locality = location.desa ?? location.kecamatan;
  const region = location.kotkab ?? location.provinsi;

  return [locality, region].filter(Boolean).join(', ');
}

function normalizeForecast(payload, now) {
  const forecasts = flattenForecasts(payload);
  const forecast = selectClosestForecast(forecasts, now);

  if (!forecast) {
    throw new BmkgError(
      'BMKG returned no usable forecast data.',
      { code: 'INVALID_RESPONSE' },
    );
  }

  const temperature = Number(forecast.t);
  const humidity = Number(forecast.hu);
  const windSpeed = Number(forecast.ws);

  return {
    description:
      forecast.weather_desc ??
      forecast.weather_desc_en ??
      'Cuaca tidak tersedia',
    humidity: Number.isFinite(humidity) ? humidity : null,
    localDateTime: forecast.local_datetime ?? null,
    location: formatLocation(payload.lokasi),
    temperature:
      Number.isFinite(temperature) ? temperature : null,
    windSpeed: Number.isFinite(windSpeed) ? windSpeed : null,
  };
}

function createBmkgClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());

  if (typeof fetchImpl !== 'function') {
    throw new BmkgError(
      'This Node.js runtime does not provide fetch.',
      { code: 'CONFIGURATION' },
    );
  }

  async function getForecast(adm4) {
    if (!ADM4_PATTERN.test(adm4 ?? '')) {
      throw new BmkgError(
        'BMKG ADM4 must use the format 00.00.00.0000.',
        { code: 'INVALID_LOCATION' },
      );
    }

    const url = new URL(BMKG_API_BASE_URL);
    url.searchParams.set('adm4', adm4);

    let response;

    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Leone Discord Bot',
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        error?.name === 'TimeoutError'
      ) {
        throw new BmkgError('BMKG request timed out.', {
          code: 'TIMEOUT',
        });
      }

      throw new BmkgError('BMKG could not be reached.', {
        code: 'UNAVAILABLE',
      });
    }

    if (response.status === 429) {
      throw new BmkgError(
        'BMKG rate limit reached. Please try again shortly.',
        {
          code: 'RATE_LIMIT',
          status: response.status,
        },
      );
    }

    if (!response.ok) {
      throw new BmkgError(
        `BMKG returned HTTP ${response.status}.`,
        {
          code: 'UPSTREAM',
          status: response.status,
        },
      );
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      throw new BmkgError('BMKG returned invalid JSON.', {
        code: 'INVALID_RESPONSE',
        status: response.status,
      });
    }

    return normalizeForecast(payload, now());
  }

  return {
    getForecast,
  };
}

module.exports = {
  ADM4_PATTERN,
  BMKG_API_BASE_URL,
  BmkgError,
  createBmkgClient,
  flattenForecasts,
  formatLocation,
  normalizeForecast,
  parseUtcDateTime,
  selectClosestForecast,
};
