const { getConfig } = require('../../config');

class GroqError extends Error {
  constructor(message, code = 'GROQ_ERROR', status = null) {
    super(message);
    this.name = 'GroqError';
    this.code = code;
    this.status = status;
  }
}

function createGroqClient(options = {}) {
  const config = options.config ?? getConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? 'https://api.groq.com/openai/v1/chat/completions';
  return {
    async chat({ messages, model = config.GROQ_MODEL, maxTokens = config.GROQ_MAX_OUTPUT_TOKENS, timeoutMs = config.GROQ_REQUEST_TIMEOUT_MS }) {
      if (!config.GROQ_API_KEY) throw new GroqError('Groq is not configured.', 'GROQ_NOT_CONFIGURED');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.GROQ_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.4, stream: false }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new GroqError(body.error?.message ?? 'Groq request failed.', response.status === 429 ? 'GROQ_RATE_LIMITED' : 'GROQ_REQUEST_FAILED', response.status);
        const message = body.choices?.[0]?.message;
        if (!message?.content || message.tool_calls?.length) throw new GroqError('Groq returned no supported text response.', 'GROQ_UNSUPPORTED_RESPONSE');
        return { content: String(message.content), model: body.model ?? model, usage: body.usage ?? {} };
      } catch (error) {
        if (error.name === 'AbortError') throw new GroqError('Groq request timed out.', 'GROQ_TIMEOUT');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { GroqError, createGroqClient };
