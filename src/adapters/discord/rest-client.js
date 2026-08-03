const {
  REST,
  Routes,
} = require('discord.js');

function toJson(value) {
  if (value && typeof value.toJSON === 'function') {
    return value.toJSON();
  }
  return value;
}

function normalizeMessagePayload(payload = {}) {
  const normalized = {};

  for (const key of ['content', 'flags', 'nonce', 'enforce_nonce', 'tts']) {
    if (payload[key] !== undefined) normalized[key] = payload[key];
  }
  if (payload.allowedMentions) normalized.allowed_mentions = payload.allowedMentions;
  if (payload.allowed_mentions) normalized.allowed_mentions = payload.allowed_mentions;
  if (payload.embeds) normalized.embeds = payload.embeds.map(toJson);
  if (payload.components) normalized.components = payload.components.map(toJson);
  if (payload.attachments) normalized.attachments = payload.attachments;

  return normalized;
}

function normalizeFiles(files = []) {
  return files.map((file) => ({
    data: file.attachment ?? file.data ?? file,
    name: file.name ?? 'attachment.bin',
    description: file.description,
  }));
}

class DiscordRestClient {
  constructor({ token, applicationId = null, rest = null }) {
    this.applicationId = applicationId;
    this.rest = rest ?? new REST({ version: '10' }).setToken(token);
    this.guildCache = new Map();
    this.botUser = null;
  }

  async getBotUser() {
    if (!this.botUser) {
      this.botUser = await this.rest.get(Routes.user('@me'));
    }
    return this.botUser;
  }

  async getGuildBundle(guildId, options = {}) {
    const cached = this.guildCache.get(guildId);
    if (!options.refresh && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const [guild, channels, roles] = await Promise.all([
      this.rest.get(Routes.guild(guildId), {
        query: new URLSearchParams({ with_counts: 'true' }),
      }),
      this.rest.get(Routes.guildChannels(guildId)),
      this.rest.get(Routes.guildRoles(guildId)),
    ]);
    const value = { guild, channels, roles };
    this.guildCache.set(guildId, {
      expiresAt: Date.now() + 30_000,
      value,
    });
    return value;
  }

  async getGuildMember(guildId, userId) {
    return this.rest.get(Routes.guildMember(guildId, userId));
  }

  async getUser(userId) {
    return this.rest.get(Routes.user(userId));
  }

  async sendChannelMessage(channelId, payload) {
    const body = normalizeMessagePayload(payload);
    const result = await this.rest.post(Routes.channelMessages(channelId), {
      body,
      files: normalizeFiles(payload.files),
    });
    return {
      ...result,
      url: `https://discord.com/channels/${result.guild_id ?? '@me'}/${channelId}/${result.id}`,
    };
  }

  async sendDirectMessage(userId, payload) {
    const channel = await this.rest.post('/users/@me/channels', {
      body: { recipient_id: userId },
    });
    return this.sendChannelMessage(channel.id, payload);
  }

  async editInteractionReply(applicationId, token, payload) {
    return this.rest.patch(
      Routes.webhookMessage(applicationId, token, '@original'),
      {
        auth: false,
        body: normalizeMessagePayload(payload),
        files: normalizeFiles(payload.files),
      },
    );
  }

  async followUp(applicationId, token, payload) {
    return this.rest.post(Routes.webhook(applicationId, token), {
      auth: false,
      body: normalizeMessagePayload(payload),
      files: normalizeFiles(payload.files),
    });
  }
}

module.exports = {
  DiscordRestClient,
  normalizeMessagePayload,
};
