const { z } = require('zod');

const optionalUrl = z.string().url().optional();
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DISCORD_TOKEN: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().regex(/^\d+$/).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  DISCORD_GUILD_ID: z.string().regex(/^\d+$/).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  PUBLIC_WEB_ORIGIN: optionalUrl.default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32).optional(),
  SCHEDULER_SECRET: z.string().min(32).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  GREETINGS_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('false'),
  BMKG_ADM4: z.string().optional(),
  GREETINGS_LOCATION: z.string().max(100).optional(),
  TMDB_API_KEY: z.string().optional(),
  TMDB_READ_ACCESS_TOKEN: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().min(1).max(120).default('llama-3.1-8b-instant'),
  GROQ_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(2000).default(600),
  GROQ_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  CHATBOT_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).max(100000).default(500),
  CHATBOT_PER_USER_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).default(15),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

let cachedConfig;

function getConfig(options = {}) {
  if (!cachedConfig || options.refresh) {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid Leone configuration: ${details}`);
    }

    cachedConfig = {
      ...parsed.data,
      greetingsSchedulerEnabled:
        parsed.data.GREETINGS_SCHEDULER_ENABLED === 'true',
      isProduction: parsed.data.NODE_ENV === 'production',
    };
  }

  return cachedConfig;
}

function requireConfig(...names) {
  const config = getConfig();
  const missing = names.filter((name) => !config[name]);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  return config;
}

module.exports = {
  getConfig,
  requireConfig,
};
