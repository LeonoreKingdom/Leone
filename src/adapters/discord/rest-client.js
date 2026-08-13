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
    this.userCache = new Map();
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

  invalidateGuild(guildId) {
    this.guildCache.delete(guildId);
  }

  async searchGuildMembers(guildId, query, limit = 25) {
    return this.rest.get(Routes.guildMembersSearch(guildId), {
      query: new URLSearchParams({
        query: String(query ?? '').slice(0, 100),
        limit: String(Math.min(Math.max(Number(limit) || 25, 1), 1000)),
      }),
    });
  }

  async createRole(guildId, payload, reason = null) {
    const result = await this.rest.post(Routes.guildRoles(guildId), {
      body: payload,
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
    this.invalidateGuild(guildId);
    return result;
  }

  async updateRole(guildId, roleId, payload, reason = null) {
    const result = await this.rest.patch(Routes.guildRole(guildId, roleId), {
      body: payload,
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
    this.invalidateGuild(guildId);
    return result;
  }

  async addMemberRole(guildId, userId, roleId, reason = null) {
    const result = await this.rest.put(Routes.guildMemberRole(guildId, userId, roleId), {
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
    this.invalidateGuild(guildId);
    return result;
  }

  async removeMemberRole(guildId, userId, roleId, reason = null) {
    const result = await this.rest.delete(Routes.guildMemberRole(guildId, userId, roleId), {
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
    this.invalidateGuild(guildId);
    return result;
  }

  async createChannel(guildId, payload, reason = null) {
    const result = await this.rest.post(Routes.guildChannels(guildId), {
      body: payload,
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
    this.invalidateGuild(guildId);
    return result;
  }

  async updateChannel(channelId, payload, reason = null) {
    const result = await this.rest.patch(Routes.channel(channelId), {
      body: payload,
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
    return result;
  }

  async setChannelPermission(channelId, overwriteId, payload, reason = null) {
    const result = await this.rest.put(Routes.channelPermission(channelId, overwriteId), {
      body: payload,
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
    return result;
  }

  async modifyGuildMember(guildId, userId, payload, reason = null) {
    return this.rest.patch(Routes.guildMember(guildId, userId), {
      body: payload,
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
  }

  async removeGuildMember(guildId, userId, reason = null) {
    return this.rest.delete(Routes.guildMember(guildId, userId), {
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
  }

  async getGuildBans(guildId, limit = 1000) {
    return this.rest.get(Routes.guildBans(guildId), {
      query: new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 1000, 1), 1000)) }),
    });
  }

  async createGuildBan(guildId, userId, deleteMessageSeconds = 0, reason = null) {
    return this.rest.put(Routes.guildBan(guildId, userId), {
      body: { delete_message_seconds: Math.min(Math.max(Number(deleteMessageSeconds) || 0, 0), 604800) },
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
  }

  async removeGuildBan(guildId, userId, reason = null) {
    return this.rest.delete(Routes.guildBan(guildId, userId), {
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
  }

  async getChannelMessages(channelId, limit = 100) {
    return this.rest.get(Routes.channelMessages(channelId), {
      query: new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 100, 1), 100)) }),
    });
  }

  async deleteMessage(channelId, messageId, reason = null) {
    return this.rest.delete(Routes.channelMessage(channelId, messageId), {
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
  }

  async bulkDeleteMessages(channelId, messageIds, reason = null) {
    return this.rest.post(`/channels/${channelId}/messages/bulk-delete`, {
      body: { messages: messageIds },
      reason: reason ? String(reason).slice(0, 512) : undefined,
    });
  }

  async getUser(userId) {
    const cached = this.userCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.rest.get(Routes.user(userId));
    this.userCache.set(userId, { value, expiresAt: Date.now() + 300_000 });
    return value;
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
