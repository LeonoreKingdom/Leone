const { SlashCommandBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check whether Leone is online and responsive.');

const help = {
  area: 'utility',
  usage: '/ping',
  summary: 'Check whether Leone is online and how quickly it responds.',
  audience: 'everyone',
  order: 20,
};

function buildPingContent({
  createdTimestamp,
  websocketLatency,
  now = Date.now(),
}) {
  const responseLatency = Math.max(
    0,
    Math.round(now - createdTimestamp),
  );
  const lines = [
    'Leone is online.',
    `Response latency: **${responseLatency} ms**`,
  ];

  if (Number.isFinite(websocketLatency)) {
    lines.push(
      `Gateway latency: **${Math.round(websocketLatency)} ms**`,
    );
  } else {
    lines.push('Transport: **HTTP interactions**');
  }

  return lines.join('\n');
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function execute(interaction) {
  await interaction.reply({
    content: buildPingContent({
      createdTimestamp: interaction.createdTimestamp,
      websocketLatency: interaction.client.ws.ping,
    }),
  });
}

module.exports = {
  buildPingContent,
  data,
  execute,
  help,
};
