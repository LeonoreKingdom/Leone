const DISCORD_TOKEN = /(?:mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,})/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\b(?:bearer|token|api[_ -]?key|secret)\s*[:=]?\s*[\w./+=-]{12,}\b/gi;

function redactText(input, options = {}) {
  const maxLength = options.maxLength ?? 4000;
  let text = String(input ?? '')
    .replace(/<@!?(\d+)>/g, '@member')
    .replace(/<@&(\d+)>/g, '@role')
    .replace(/<#(\d+)>/g, '#channel')
    .replace(EMAIL, '[redacted email]')
    .replace(DISCORD_TOKEN, '[redacted token]')
    .replace(BEARER, '[redacted secret]')
    .replace(/\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, '[redacted password]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim();
  return text ? text.slice(0, maxLength) : '';
}

function sanitizeResponse(input, maxLength = 1900) {
  return redactText(input, { maxLength })
    .replace(/@(everyone|here)/gi, '@$1')
    .replace(/<@!?\d+>/g, '@member')
    .replace(/<@&\d+>/g, '@role')
    .trim();
}

module.exports = { redactText, sanitizeResponse };
