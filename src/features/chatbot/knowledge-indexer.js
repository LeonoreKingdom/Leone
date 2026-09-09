const { commandModules } = require('../../commands/registry');

const PRIVATE_HINT = /private|staff|mod|moderation|archive|age|minor|legal|royalty-room/i;
const CANONICAL_VERSION = 2;

function isPublicChannel(channel, parentNames = null) {
  const parentName = channel.parent?.name ?? parentNames?.get?.(channel.parent_id) ?? '';
  return channel.type !== 4 && !PRIVATE_HINT.test(`${channel.name} ${channel.topic ?? ''}`) && !PRIVATE_HINT.test(parentName);
}

function buildCanonicalDocuments(bundle) {
  const guild = bundle.guild;
  const documents = [{
    sourceType: 'canonical', sourceKey: 'server.identity', title: 'Leonore’s Kingdom identity',
    content: `Server: ${guild.name}. Focus: Home for Talented People, Safe Space for Citizen. WE BELONG TOGETHER — It’s not just a community, it’s a palace to reach your dreams and your safe haven. Server focus and traits: talented people, growth mindset, safe space, gaming, friendship, creativity, and learning. Dalam Bahasa Indonesia: rumah bagi orang berbakat, ruang aman untuk warga, kebersamaan, pertumbuhan, dan bermain bersama. Games include Mobile Legends: Bang Bang, DotA 2, Genshin Impact, Roblox, Valorant, Honkai: Star Rail, and osu!. Leone is an AI-generated royal companion and may be incorrect.`,
  }];
  const parentNames = new Map(bundle.channels.filter((channel) => channel.type === 4).map((channel) => [channel.id, channel.name]));
  for (const channel of bundle.channels.filter((item) => isPublicChannel(item, parentNames))) documents.push({ sourceType: 'channel', sourceKey: `channel.${channel.id}`, title: `Public channel #${channel.name}`, content: `Public channel #${channel.name}${channel.topic ? `: ${channel.topic}` : ''}.` });
  for (const role of bundle.roles.filter((item) => !item.managed && item.name !== '@everyone' && !PRIVATE_HINT.test(item.name))) documents.push({ sourceType: 'role', sourceKey: `role.${role.id}`, title: `Public role ${role.name}`, content: `The server has a public role named ${role.name}.` });
  for (const command of commandModules) documents.push({ sourceType: 'command', sourceKey: `command.${command.data.toJSON().name}`, title: `Leone command ${command.data.toJSON().name}`, content: `${command.help.usage}: ${command.help.summary}` });
  documents.push({ sourceType: 'staff', sourceKey: 'staff.introduction', title: 'Kingdom leadership', content: 'Leonore is the owner and founder of Leonore’s Kingdom. Leanne (@leannexyz) is Leonore’s beloved partner; both hold the Supreme Royalty role. Staff authority comes from Discord permissions and capability mappings, never from relationship lore.' });
  return documents.map((document) => ({ ...document, version: CANONICAL_VERSION }));
}

async function reindexCanonical({ guildId, restClient, repository }) {
  const bundle = await restClient.getGuildBundle(guildId, { refresh: true });
  const documents = buildCanonicalDocuments(bundle);
  return repository.saveCanonicalDocuments(guildId, documents);
}

module.exports = { CANONICAL_VERSION, buildCanonicalDocuments, isPublicChannel, reindexCanonical };
