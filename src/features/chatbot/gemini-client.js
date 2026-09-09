class GeminiError extends Error {
  constructor(message, code = 'GEMINI_ERROR', status = null) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.status = status;
  }
}

function normalizeModel(model) {
  const value = String(model ?? '').trim();
  return value.startsWith('models/') ? value.slice('models/'.length) : value;
}

function toGeminiContents(messages = []) {
  return messages
    .filter((message) => message?.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content ?? '') }],
    }))
    .filter((message) => message.parts[0].text);
}

function createGeminiClient(options = {}) {
  const config = options.config ?? {};
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiRoot = options.apiRoot ?? 'https://generativelanguage.googleapis.com/v1beta';

  return {
    async chat({ messages, model = config.GEMINI_MODEL, maxTokens = config.GEMINI_MAX_OUTPUT_TOKENS, timeoutMs = config.GEMINI_REQUEST_TIMEOUT_MS }) {
      if (!config.GEMINI_API_KEY) throw new GeminiError('Gemini is not configured.', 'GEMINI_NOT_CONFIGURED');
      const normalizedModel = normalizeModel(model);
      if (!normalizedModel) throw new GeminiError('Gemini model is not configured.', 'GEMINI_MODEL_NOT_CONFIGURED');

      const systemText = messages
        .filter((message) => message?.role === 'system')
        .map((message) => String(message.content ?? '').trim())
        .filter(Boolean)
        .join('\n\n');
      const payload = {
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: maxTokens },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${apiRoot}/models/${encodeURIComponent(normalizedModel)}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': config.GEMINI_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const providerStatus = String(body.error?.status ?? '').toUpperCase();
          const providerMessage = String(body.error?.message ?? '');
          const temporarilyUnavailable = [500, 502, 503, 529].includes(response.status)
            || providerStatus === 'UNAVAILABLE'
            || /high demand|temporarily unavailable|try again later/i.test(providerMessage);
          const code = response.status === 429 ? 'GEMINI_RATE_LIMITED'
            : response.status === 408 || response.status === 504 ? 'GEMINI_TIMEOUT'
              : response.status === 401 || response.status === 403 ? 'GEMINI_AUTH_FAILED'
                : temporarilyUnavailable ? 'GEMINI_TEMPORARILY_UNAVAILABLE'
                  : 'GEMINI_REQUEST_FAILED';
          throw new GeminiError(body.error?.message ?? 'Gemini request failed.', code, response.status);
        }
        const parts = body.candidates?.[0]?.content?.parts ?? [];
        if (parts.some((part) => part.functionCall || part.executableCode)) throw new GeminiError('Gemini returned an unsupported tool call.', 'GEMINI_UNSUPPORTED_RESPONSE');
        const content = parts.map((part) => part.text).filter(Boolean).join('');
        if (!content) throw new GeminiError('Gemini returned no text response.', 'GEMINI_UNSUPPORTED_RESPONSE');
        const usage = body.usageMetadata ?? {};
        return {
          content: String(content),
          model: body.modelVersion ?? normalizedModel,
          usage: { prompt_tokens: usage.promptTokenCount ?? 0, completion_tokens: usage.candidatesTokenCount ?? 0 },
        };
      } catch (error) {
        if (error.name === 'AbortError') throw new GeminiError('Gemini request timed out.', 'GEMINI_TIMEOUT');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { GeminiError, createGeminiClient, normalizeModel, toGeminiContents };
