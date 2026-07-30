const {
  componentHandler: serverMapComponentHandler,
} = require('../features/kingdom/server-map/components');

const componentHandlers = [
  serverMapComponentHandler,
];
const componentRegistry = new Map();

for (const handler of componentHandlers) {
  if (!handler.prefix || typeof handler.execute !== 'function') {
    throw new Error(
      'Every component handler must export a prefix and execute function.',
    );
  }

  if (componentRegistry.has(handler.prefix)) {
    throw new Error(
      `Duplicate component prefix: "${handler.prefix}".`,
    );
  }

  componentRegistry.set(handler.prefix, handler);
}

/**
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @returns {Promise<boolean>} Whether Leone handled the component.
 */
async function executeComponent(interaction) {
  const [prefix, ...parameters] =
    interaction.customId.split(':');
  const handler = componentRegistry.get(prefix);

  if (!handler) {
    return false;
  }

  await handler.execute(interaction, parameters);
  return true;
}

module.exports = {
  componentRegistry,
  executeComponent,
};
