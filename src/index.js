require('dotenv').config();

const { ActivityType, Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');

const { executeCommand } = require('./commands');

if (!process.env.DISCORD_TOKEN) {
  throw new Error('Missing required environment variable: DISCORD_TOKEN');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Leone logged in as ${readyClient.user.tag}`);

  readyClient.user.setPresence({
    activities: [
      {
        name: '/help',
        type: ActivityType.Listening,
      },
    ],
    status: 'online',
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    await executeCommand(interaction);
  } catch (error) {
    console.error(`Command "${interaction.commandName}" failed:`, error);

    const errorResponse = {
      content: 'Leone encountered an error while processing this command.',
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorResponse);
    } else {
      await interaction.reply(errorResponse);
    }
  }
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.login(process.env.DISCORD_TOKEN);
