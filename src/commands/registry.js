const helpCommand = require('./help.command');
const kingdomCommands = require('../features/kingdom');
const recommendationCommands = require('../features/recommendations');
const relationshipCommands = require('../features/relationships');
const systemCommands = require('../features/system');
const { areas } = require('./areas');

const commandModules = [
  ...systemCommands,
  helpCommand,
  ...kingdomCommands,
  ...relationshipCommands,
  ...recommendationCommands,
];
const commandRegistry = new Map();

for (const command of commandModules) {
  if (!command.data || typeof command.execute !== 'function') {
    throw new Error(
      'Every command must export data and an execute function.',
    );
  }

  if (!command.help) {
    throw new Error(
      `Command "${command.data.name}" is missing help metadata.`,
    );
  }

  if (!areas[command.help.area]) {
    throw new Error(
      `Command "${command.data.name}" references unknown help area "${command.help.area}".`,
    );
  }

  const commandName = command.data.toJSON().name;

  if (commandRegistry.has(commandName)) {
    throw new Error(
      `Duplicate command registration: "${commandName}".`,
    );
  }

  commandRegistry.set(commandName, command);
}

const commands = commandModules.map((command) => command.data);

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeCommand(interaction) {
  const command = commandRegistry.get(interaction.commandName);

  if (!command) {
    throw new Error(
      `Unsupported command: ${interaction.commandName}`,
    );
  }

  await command.execute(interaction, {
    commandModules,
    commandRegistry,
  });
}

module.exports = {
  commandModules,
  commandRegistry,
  commands,
  executeCommand,
};
