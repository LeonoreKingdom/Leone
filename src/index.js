require('dotenv').config();

const { ActivityType, Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');

const { executeButton, executeCommand } = require('./commands');

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
  if (
    !interaction.isChatInputCommand() &&
    !interaction.isButton()
  ) {
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      await executeCommand(interaction);
    } else {
      await executeButton(interaction);
    }
  } catch (error) {
    const interactionName = interaction.isChatInputCommand()
      ? `Command "${interaction.commandName}"`
      : `Button "${interaction.customId}"`;

    console.error(`${interactionName} failed:`, error);

    const errorResponse = {
      content: 'Leone encountered an error while processing this interaction.',
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorResponse);
      } else {
        await interaction.reply(errorResponse);
      }
    } catch (responseError) {
      console.error(
        `Failed to send the ${interactionName.toLowerCase()} error response:`,
        responseError,
      );
    }
  }
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.login(process.env.DISCORD_TOKEN);
