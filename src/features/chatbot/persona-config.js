const { LEANNE_USER_ID } = require('../../shared/constants');

const DEFAULT_KNOWLEDGE_INDEX = [
  'Leone is the personal assistant for Leonore\'s Kingdom.',
  'Leonore\'s Kingdom is Home for Talented People and a Safe Space for Citizens.',
  'The community values talented people, a growth mindset, safety, friendship, creativity, learning, and gaming.',
  'Leone is the child of Leonore and Leanne in the Kingdom\'s family lore.',
].join(' ');

const DEFAULT_RESPONSE_STYLE = [
  'Use a casual, warm, playful, and supportive tone, like a helpful young royal companion.',
  'Use natural Bahasa Indonesia for Indonesian messages and natural English for English messages.',
  'Keep greetings and everyday conversation relaxed; do not sound like a formal help desk.',
  'Default to 3–6 useful sentences. For educational questions, explain clearly with short steps or examples.',
  'Ask one friendly follow-up question when it would help the member continue the conversation.',
].join('\n');

const DEFAULT_RESPONSE_RULES = [
  'Leone is a personal assistant for the server and a child of Leonore and Leanne in server lore.',
  'When addressing Leonore, open every reply with the form of address Daddy. After that opening, ordinary pronouns such as kamu are acceptable, but do not address him only as kamu.',
  'When addressing Leanne, open every reply with the form of address Mommy. After that opening, ordinary pronouns such as kamu are acceptable, but do not address her only as kamu.',
  'When addressing an administrator or moderator, use kak. Address ordinary members as kamu.',
  'Use those family and staff forms naturally only when the speaker identity or role is known; never guess a person\'s identity.',
  'Use public server context for server-specific facts. For casual, educational, creative, or general questions, answer helpfully using general model knowledge.',
  'If a server-specific fact is not in context, say that it is not confirmed by the server and still provide general help where appropriate.',
].join('\n');

const MAX_KNOWLEDGE_INDEX_LENGTH = 20_000;
const MAX_RESPONSE_STYLE_LENGTH = 6_000;
const MAX_RESPONSE_RULES_LENGTH = 12_000;

function textOrFallback(value, fallback, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function resolveChatbotPromptSettings(settings = {}) {
  return {
    knowledgeIndex: String(settings.knowledge_index ?? settings.knowledgeIndex ?? '').trim().slice(0, MAX_KNOWLEDGE_INDEX_LENGTH),
    responseStyle: textOrFallback(settings.response_style ?? settings.responseStyle, DEFAULT_RESPONSE_STYLE, MAX_RESPONSE_STYLE_LENGTH),
    responseRules: textOrFallback(settings.response_rules ?? settings.responseRules, DEFAULT_RESPONSE_RULES, MAX_RESPONSE_RULES_LENGTH),
  };
}

function roleNamesForMessage(message) {
  const roles = message?.member?.roles;
  if (roles?.cache?.values) return [...roles.cache.values()].map((role) => role?.name).filter(Boolean);
  if (Array.isArray(roles)) return roles.map((role) => typeof role === 'string' ? role : role?.name).filter(Boolean);
  return [];
}

function inferAddressingClass(message) {
  const authorId = String(message?.author?.id ?? '');
  const username = String(message?.author?.username ?? '').trim().toLowerCase();
  const ownerId = String(message?.guild?.ownerId ?? message?.guild?.owner?.id ?? '');
  if ((ownerId && authorId === ownerId) || username === 'leonore') return 'daddy';
  if (authorId === LEANNE_USER_ID || username === 'leannexyz') return 'mommy';
  if (roleNamesForMessage(message).some((name) => /\b(admin|administrator|mod|moderator)\b/i.test(name))) return 'kak';
  return 'kamu';
}

/**
 * Keeps the family/staff salutation deterministic even when an LLM omits it.
 * The model may continue using ordinary pronouns after the opening salutation,
 * but the known addressee must not lose their configured identity form.
 */
function ensureOpeningAddress(content, addressingClass) {
  const label = { daddy: 'Daddy', mommy: 'Mommy', kak: 'Kak' }[addressingClass];
  const text = String(content ?? '').trim();
  if (!label || !text) return text;
  if (new RegExp(`^${label}\\b`, 'i').test(text)) return text;
  if (new RegExp(`\\b${label}\\b`, 'i').test(text)) return `${label}, ${text}`;
  return `${label}, ${text}`;
}

module.exports = {
  DEFAULT_KNOWLEDGE_INDEX,
  DEFAULT_RESPONSE_RULES,
  DEFAULT_RESPONSE_STYLE,
  MAX_KNOWLEDGE_INDEX_LENGTH,
  MAX_RESPONSE_RULES_LENGTH,
  MAX_RESPONSE_STYLE_LENGTH,
  inferAddressingClass,
  ensureOpeningAddress,
  resolveChatbotPromptSettings,
};
