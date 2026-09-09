const { z } = require('zod');

const optionalUrl = z.string().url().optional();
const optionalSecret = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(16).optional(),
);
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
  LLM_PROVIDER: z.enum(['gemini', 'groq']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).max(120).default('gemini-3.8-flash'),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(2000).default(600),
  GEMINI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().min(1).max(120).default('llama-3.1-8b-instant'),
  GROQ_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(2000).default(600),
  GROQ_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  SERVER_STATS_API_KEY: optionalSecret,
  STATS_FEATURED_USER_IDS: z.string().optional(),
  STATS_CITIZEN_ROLE_NAME: z.string().min(1).max(100).default('Citizen'),
  STATS_ADMIN_ROLE_NAME: z.string().min(1).max(100).default('Admin'),
  STATS_MODERATOR_ROLE_NAME: z.string().min(1).max(100).default('Moderator'),
  STATS_ROLE_PROFILE_LIMIT: z.coerce.number().int().min(1).max(5).default(2),
  STATS_MAX_MEMBER_PAGES: z.coerce.number().int().min(1).max(1000).default(100),
  STATS_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
  STATS_GATEWAY_SNAPSHOT_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(900).default(180),
  SERVER_STATS_GATEWAY_ENABLED: z.enum(['true', 'false']).default('false'),
  STATS_GATEWAY_SNAPSHOT_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(300).default(30),
  // Keep the default conservative for Gemini AI Studio's free tier. A guild
  // setting may choose a lower limit, but the worker enforces this value as a
  // hard application cap so a stale database setting cannot enable unlimited
  // paid usage accidentally.
  CHATBOT_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).max(100000).default(100),
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
      serverStatsGatewayEnabled:
        parsed.data.SERVER_STATS_GATEWAY_ENABLED === 'true',
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
