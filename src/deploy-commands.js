require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands } = require('./commands/registry');

const requiredVariables = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `Missing required environment variable: ${variable}`,
    );
  }
}

const rest = new REST({ version: '10' }).setToken(
  process.env.DISCORD_TOKEN,
);

async function deployCommands() {
  const commandPayload = commands.map((command) =>
    command.toJSON(),
  );

  console.log(
    `Registering ${commandPayload.length} guild commands...`,
  );

  const registeredCommands = await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID,
    ),
    {
      body: commandPayload,
    },
  );

  console.log(
    `Registered ${registeredCommands.length} commands successfully.`,
  );
}

deployCommands().catch((error) => {
  console.error('Command registration failed:', error);
  process.exitCode = 1;
});
