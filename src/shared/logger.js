const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function redact(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const copy = Array.isArray(value) ? [...value] : { ...value };

  for (const key of Object.keys(copy)) {
    if (/token|secret|password|authorization|content/i.test(key)) {
      copy[key] = '[REDACTED]';
    } else if (copy[key] && typeof copy[key] === 'object') {
      copy[key] = redact(copy[key]);
    }
  }

  return copy;
}

function write(level, event, metadata = {}) {
  const configuredLevel = process.env.LOG_LEVEL ?? 'info';

  if (LEVELS[level] < (LEVELS[configuredLevel] ?? LEVELS.info)) {
    return;
  }

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redact(metadata),
  });

  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

function createLogger(options = {}) {
  const minimum = LEVELS[options.level] ?? LEVELS.info;
  const scopedWrite = (level, event, metadata = {}) => {
    if (LEVELS[level] < minimum) return;
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...redact(metadata),
    });
    if (level === 'error') console.error(entry);
    else if (level === 'warn') console.warn(entry);
    else console.log(entry);
  };
  return {
    debug: (event, metadata) => scopedWrite('debug', event, metadata),
    error: (event, metadata) => scopedWrite('error', event, metadata),
    info: (event, metadata) => scopedWrite('info', event, metadata),
    warn: (event, metadata) => scopedWrite('warn', event, metadata),
  };
}

module.exports = {
  createLogger,
  debug: (event, metadata) => write('debug', event, metadata),
  error: (event, metadata) => write('error', event, metadata),
  info: (event, metadata) => write('info', event, metadata),
  warn: (event, metadata) => write('warn', event, metadata),
};
