const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ChannelType,
  Collection,
  MessageFlags,
} = require('discord.js');

const {
  commandModules,
  commandRegistry,
  commands,
  executeCommand,
} = require('../src/commands/registry');
const {
  executeComponent,
} = require('../src/interactions/component-registry');

const client = {
  user: {
    displayAvatarURL: () => 'https://example.com/leone.png',
  },
  ws: {
    ping: 42,
  },
};

function createGuild() {
  const visible = () => ({ has: () => true });
  const channels = new Collection([
    [
      'category-1',
      {
        id: 'category-1',
        name: 'WELCOME',
        type: ChannelType.GuildCategory,
        rawPosition: 0,
      },
    ],
    [
      'rules-1',
      {
        id: 'rules-1',
        name: 'kingdom-rules',
        type: ChannelType.GuildText,
        rawPosition: 0,
        parentId: 'category-1',
        permissionsFor: visible,
      },
    ],
    [
      'general-1',
      {
        id: 'general-1',
        name: 'general',
        type: ChannelType.GuildText,
        rawPosition: 1,
        parentId: 'category-1',
        permissionsFor: visible,
      },
    ],
  ]);
  const roles = new Collection([
    [
      'supreme-1',
      {
        id: 'supreme-1',
        name: 'Supreme Royalty',
      },
    ],
    [
      'admin-1',
      {
        id: 'admin-1',
        name: 'Admin',
      },
    ],
    [
      'moderator-1',
      {
        id: 'moderator-1',
        name: 'Moderator',
      },
    ],
  ]);

  return {
    id: 'guild-1',
    name: "Leonore's Kingdom",
    ownerId: 'owner-1',
    memberCount: 3259,
    createdTimestamp: Date.UTC(2020, 0, 1),
    rulesChannelId: 'rules-1',
    channels: { cache: channels },
    roles: { cache: roles },
    iconURL: () => null,
  };
}

function createCommandInteraction(
  commandName,
  overrides = {},
) {
  let response;
  let deferred = false;

  const interaction = {
    commandName,
    client,
    createdTimestamp: Date.now() - 10,
    guild: createGuild(),
    member: {},
    memberPermissions: null,
    options: {
      getString: () => null,
    },
    user: {
      id: '123456789012345678',
    },
    inGuild: () => true,
    deferReply: async () => {
      deferred = true;
    },
    editReply: async (payload) => {
      response = payload;
    },
    reply: async (payload) => {
      response = payload;
    },
    ...overrides,
  };

  return {
    interaction,
    get deferred() {
      return deferred;
    },
    get response() {
      return response;
    },
  };
}

function countEmbedCharacters(embedBuilder) {
  const embed = embedBuilder.toJSON();

  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.fields ?? []).reduce(
      (total, field) =>
        total + field.name.length + field.value.length,
      0,
    )
  );
}

test('registry contains unique commands with valid help metadata', () => {
  const payload = commands.map((command) => command.toJSON());
  const names = payload.map((command) => command.name);

  assert.deepEqual(names, [
    'ping',
    'help',
    'about',
    'staff',
    'server-map',
    'rules',
    'server',
    'bonds',
    'recommend',
    'movie',
    'anime',
    'greetings',
    'weather',
  ]);
  assert.equal(new Set(names).size, names.length);
  assert.equal(commandRegistry.size, names.length);
  assert.equal(commandModules.length, names.length);
  const recommendPayload = payload.find((command) => command.name === 'recommend');
  assert.deepEqual(
    recommendPayload.options.map((option) => option.name),
    ['movie', 'anime'],
  );
  assert.equal(names.includes('recommendanime'), false);

  for (const command of commandModules) {
    assert.ok(command.help.area);
    assert.ok(command.help.usage);
    assert.ok(command.help.summary);
    assert.equal(typeof command.execute, 'function');
  }
});

test('help is generated from registered command metadata', async () => {
  const allAreas = createCommandInteraction('help');

  await executeCommand(allAreas.interaction);

  const allAreasEmbed =
    allAreas.response.embeds[0].toJSON();
  const allAreasText = JSON.stringify(allAreasEmbed);

  assert.equal(
    allAreas.response.flags,
    MessageFlags.Ephemeral,
  );
  assert.match(allAreasText, /Kingdom/);
  assert.match(allAreasText, /Relationships/);
  assert.match(allAreasText, /Recommendations/);
  assert.match(allAreasText, /Movies/);
  assert.match(allAreasText, /Anime/);
  assert.match(allAreasText, /Weather/);
  assert.match(allAreasText, /Utilities/);
  assert.match(allAreasText, /server-map/);
  assert.doesNotMatch(allAreasText, /Automation/);

  const staffAreas = createCommandInteraction('help', {
    memberPermissions: {
      has: () => true,
    },
  });

  await executeCommand(staffAreas.interaction);

  const staffAreasText = JSON.stringify(
    staffAreas.response.embeds[0].toJSON(),
  );

  assert.match(staffAreasText, /Automation/);
  assert.match(staffAreasText, /greetings/);

  const kingdomOnly = createCommandInteraction('help', {
    options: {
      getString: () => 'kingdom',
    },
  });

  await executeCommand(kingdomOnly.interaction);

  const kingdomEmbed =
    kingdomOnly.response.embeds[0].toJSON();
  const kingdomText = JSON.stringify(kingdomEmbed);

  assert.match(kingdomText, /Kingdom/);
  assert.doesNotMatch(kingdomText, /Utilities/);

  const relationshipsOnly = createCommandInteraction('help', {
    options: {
      getString: () => 'relationships',
    },
  });

  await executeCommand(relationshipsOnly.interaction);

  const relationshipsText = JSON.stringify(
    relationshipsOnly.response.embeds[0].toJSON(),
  );

  assert.match(relationshipsText, /Relationships/);
  assert.match(relationshipsText, /bonds/);
  assert.doesNotMatch(relationshipsText, /Utilities/);
});

test('Kingdom commands preserve personalized content and live routing', async () => {
  for (const commandName of [
    'about',
    'staff',
    'rules',
    'server',
  ]) {
    const command = createCommandInteraction(commandName);

    await executeCommand(command.interaction);

    assert.ok(command.response.embeds.length >= 1);
  }

  const about = createCommandInteraction('about');
  await executeCommand(about.interaction);
  const aboutText = JSON.stringify(
    about.response.embeds[0].toJSON(),
  );

  assert.match(aboutText, /1427688270363627675/);
  assert.match(
    aboutText,
    /his girlfriend and partner in the Kingdom/,
  );
  assert.match(
    JSON.stringify(
      about.response.embeds.map((embed) => embed.toJSON()),
    ),
    /not endorsed or certified by TMDB/,
  );

  const staff = createCommandInteraction('staff');
  await executeCommand(staff.interaction);
  const staffText = JSON.stringify(
    staff.response.embeds[0].toJSON(),
  );

  assert.match(staffText, /Supreme Royalty/);
  assert.match(staffText, /1427688270363627675/);

  const rules = createCommandInteraction('rules');
  await executeCommand(rules.interaction);
  const rulesText = JSON.stringify(
    rules.response.embeds[0].toJSON(),
  );

  assert.match(rulesText, /<#rules-1>/);
});

test('owner-sized server maps stay within limits and paginate safely', async () => {
  const guild = createGuild();
  const visible = () => ({ has: () => true });

  for (
    let categoryIndex = 0;
    categoryIndex < 40;
    categoryIndex += 1
  ) {
    const categoryId = `large-category-${categoryIndex}`;

    guild.channels.cache.set(categoryId, {
      id: categoryId,
      name: `CATEGORY ${categoryIndex}`,
      type: ChannelType.GuildCategory,
      rawPosition: categoryIndex + 1,
    });

    for (
      let channelIndex = 0;
      channelIndex < 10;
      channelIndex += 1
    ) {
      const channelId = `1234567890${String(
        categoryIndex,
      ).padStart(4, '0')}${String(channelIndex).padStart(
        4,
        '0',
      )}`;

      guild.channels.cache.set(channelId, {
        id: channelId,
        name: `channel-${channelIndex}`,
        type: ChannelType.GuildText,
        rawPosition: channelIndex,
        parentId: categoryId,
        permissionsFor: visible,
      });
    }
  }

  const map = createCommandInteraction('server-map', {
    guild,
  });

  await executeCommand(map.interaction);

  assert.equal(map.deferred, true);
  assert.equal(map.response.embeds.length, 1);
  assert.ok(
    countEmbedCharacters(map.response.embeds[0]) <= 6000,
  );
  assert.equal(map.response.components.length, 1);

  const nextButton = map.response.components[0]
    .toJSON()
    .components.find((component) => component.label === 'Next');
  let buttonDeferred = false;
  let buttonResponse;
  const handled = await executeComponent({
    customId: nextButton.custom_id,
    user: map.interaction.user,
    guild,
    member: {},
    inGuild: () => true,
    deferUpdate: async () => {
      buttonDeferred = true;
    },
    editReply: async (payload) => {
      buttonResponse = payload;
    },
  });

  assert.equal(handled, true);
  assert.equal(buttonDeferred, true);
  assert.equal(buttonResponse.embeds.length, 1);
  assert.ok(
    countEmbedCharacters(buttonResponse.embeds[0]) <= 6000,
  );
  assert.match(
    buttonResponse.embeds[0].toJSON().title,
    /Page 2/,
  );

  let unauthorizedResponse;
  await executeComponent({
    customId: nextButton.custom_id,
    user: {
      id: '999999999999999999',
    },
    reply: async (payload) => {
      unauthorizedResponse = payload;
    },
  });

  assert.equal(
    unauthorizedResponse.flags,
    MessageFlags.Ephemeral,
  );
});
