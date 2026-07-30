const { SlashCommandBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check whether Leone is online and responsive.');

const help = {
  area: 'utility',
  usage: '/ping',
  summary: 'Check Leone response and WebSocket latency.',
  audience: 'everyone',
  order: 20,
};

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function execute(interaction) {
  const responseLatency =
    Date.now() - interaction.createdTimestamp;
  const websocketLatency = Math.round(interaction.client.ws.ping);

  await interaction.reply({
    content: [
      'Leone is online.',
      `Response latency: **${responseLatency} ms**`,
      `WebSocket latency: **${websocketLatency} ms**`,
    ].join('\n'),
  });
}

module.exports = {
  data,
  execute,
  help,
};
