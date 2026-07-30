const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const KINGDOM_COLOR = 0x1b2a4e;
const CHANNELS_PER_FIELD_LENGTH = 950;
const MAP_FIELDS_PER_EMBED = 20;
const SERVER_MAP_BUTTON_PREFIX = 'server-map';
const LEANNE_USER_ID =
  process.env.LEANNE_USER_ID ?? '1427688270363627675';

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check whether Leone is online and responsive.'),

  new SlashCommandBuilder().setName('help').setDescription('Display Leone command information.'),

  new SlashCommandBuilder()
    .setName('about')
    .setDescription("Learn about Leonore's Kingdom and its royal companion, Leone."),

  new SlashCommandBuilder()
    .setName('staff')
    .setDescription("Meet the Kingdom's Supreme Royalty, admins, and moderators."),

  new SlashCommandBuilder()
    .setName('server-map')
    .setDescription('Explore the server categories and channels you can access.'),

  new SlashCommandBuilder()
    .setName('rules')
    .setDescription("Find Leonore's Kingdom official rules and community guidelines."),

  new SlashCommandBuilder().setName('server').setDescription('Display information about this Discord server.'),
];

/**
 * Find the first role whose name matches one of the supplied names.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string[]} names
 */
function findRoleByName(guild, names) {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));

  return guild.roles.cache.find((role) =>
    normalizedNames.has(role.name.toLowerCase()),
  );
}

/**
 * Format a role without pinging its members.
 *
 * @param {import('discord.js').Role | undefined} role
 * @param {string} fallbackName
 */
function formatRole(role, fallbackName) {
  return role
    ? `<@&${role.id}>`
    : `**${fallbackName}** *(role not configured)*`;
}

/**
 * Check whether the interaction member can view a channel.
 *
 * @param {import('discord.js').GuildBasedChannel} channel
 * @param {import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember} member
 */
function canViewChannel(channel, member) {
  return Boolean(
    channel
      .permissionsFor(member)
      ?.has(PermissionFlagsBits.ViewChannel),
  );
}

/**
 * Pack channel mentions into Discord embed-field-sized strings.
 *
 * @param {string[]} mentions
 */
function packChannelMentions(mentions) {
  const chunks = [];
  let currentChunk = '';

  for (const mention of mentions) {
    const candidate = currentChunk
      ? `${currentChunk} • ${mention}`
      : mention;

    if (
      candidate.length > CHANNELS_PER_FIELD_LENGTH &&
      currentChunk
    ) {
      chunks.push(currentChunk);
      currentChunk = mention;
    } else {
      currentChunk = candidate;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Build a paginated map containing only channels visible to the caller.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember} member
 */
function buildServerMapEmbeds(guild, member) {
  const allChannels = [...guild.channels.cache.values()];
  const visibleChannels = allChannels.filter(
    (channel) =>
      channel.type !== ChannelType.GuildCategory &&
      canViewChannel(channel, member),
  );
  const categories = allChannels
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort(
      (left, right) =>
        left.rawPosition - right.rawPosition ||
        left.name.localeCompare(right.name),
    );
  const fields = [];

  const addChannelGroup = (groupName, channels) => {
    const mentions = channels
      .sort(
        (left, right) =>
          left.rawPosition - right.rawPosition ||
          left.name.localeCompare(right.name),
      )
      .map((channel) => `<#${channel.id}>`);

    for (const [index, value] of packChannelMentions(mentions).entries()) {
      fields.push({
        name:
          index === 0
            ? `🏰 ${groupName}`
            : `↳ ${groupName} (continued)`,
        value,
      });
    }
  };

  for (const category of categories) {
    const childChannels = visibleChannels.filter(
      (channel) => channel.parentId === category.id,
    );

    if (childChannels.length > 0) {
      addChannelGroup(category.name, childChannels);
    }
  }

  const uncategorizedChannels = visibleChannels.filter(
    (channel) => !channel.parentId,
  );

  if (uncategorizedChannels.length > 0) {
    addChannelGroup('Other channels', uncategorizedChannels);
  }

  if (fields.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(KINGDOM_COLOR)
        .setTitle(`${guild.name} — Kingdom Map`)
        .setDescription('No channels are currently visible to you.'),
    ];
  }

  const pages = [];
  let currentPage = [];
  let currentPageLength = 0;

  for (const field of fields) {
    const fieldLength = field.name.length + field.value.length;
    const pageIsFull =
      currentPage.length >= MAP_FIELDS_PER_EMBED ||
      (currentPage.length > 0 &&
        currentPageLength + fieldLength > 5000);

    if (pageIsFull) {
      pages.push(currentPage);
      currentPage = [];
      currentPageLength = 0;
    }

    currentPage.push(field);
    currentPageLength += fieldLength;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  const visiblePages = pages.slice(0, 10);
  const wasTruncated = pages.length > visiblePages.length;

  return visiblePages.map((pageFields, index) => {
    const embed = new EmbedBuilder()
      .setColor(KINGDOM_COLOR)
      .setTitle(
        index === 0
          ? `${guild.name} — Kingdom Map`
          : `Kingdom Map — Page ${index + 1}`,
      )
      .addFields(pageFields);

    if (index === 0) {
      embed.setDescription(
        [
          'Only channels you can currently view are shown.',
          wasTruncated
            ? 'This server is too large to display every channel in one response.'
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    if (visiblePages.length > 1) {
      embed.setFooter({
        text: `Page ${index + 1} of ${visiblePages.length}`,
      });
    }

    return embed;
  });
}

/**
 * Build Previous/Next controls for a server-map page.
 *
 * @param {string} requesterId
 * @param {number} pageIndex
 * @param {number} pageCount
 */
function buildServerMapComponents(
  requesterId,
  pageIndex,
  pageCount,
) {
  if (pageCount <= 1) {
    return [];
  }

  const previousPageIndex = Math.max(0, pageIndex - 1);
  const nextPageIndex = Math.min(pageCount - 1, pageIndex + 1);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${SERVER_MAP_BUTTON_PREFIX}:${requesterId}:${previousPageIndex}`,
      )
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(
        `${SERVER_MAP_BUTTON_PREFIX}:${requesterId}:${nextPageIndex}`,
      )
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIndex === pageCount - 1),
  );

  return [row];
}

/**
 * Locate the configured rules channel, then fall back to a visible
 * rules/guidelines channel by name.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember} member
 */
function findRulesChannel(guild, member) {
  const configuredRulesChannel = guild.rulesChannelId
    ? guild.channels.cache.get(guild.rulesChannelId)
    : null;

  if (
    configuredRulesChannel &&
    canViewChannel(configuredRulesChannel, member)
  ) {
    return configuredRulesChannel;
  }

  return [...guild.channels.cache.values()]
    .filter(
      (channel) =>
        channel.type !== ChannelType.GuildCategory &&
        canViewChannel(channel, member) &&
        (channel.name.toLowerCase().includes('rule') ||
          channel.name.toLowerCase().includes('guideline')),
    )
    .sort(
      (left, right) =>
        left.rawPosition - right.rawPosition ||
        left.name.localeCompare(right.name),
    )[0];
}

/**
 * Execute a registered slash command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeCommand(interaction) {
  switch (interaction.commandName) {
    case 'ping': {
      const responseLatency = Date.now() - interaction.createdTimestamp;

      const websocketLatency = Math.round(interaction.client.ws.ping);

      await interaction.reply({
        content: ['Leone is online.', `Response latency: **${responseLatency} ms**`, `WebSocket latency: **${websocketLatency} ms**`].join('\n'),
      });

      break;
    }

    case 'help': {
      const embed = new EmbedBuilder()
        .setColor(KINGDOM_COLOR)
        .setTitle('👑 Leone — Kingdom Commands')
        .setDescription(
          "Your guide to Leonore's Kingdom. Choose a command below to begin.",
        )
        .addFields(
          {
            name: '🏰 Explore the Kingdom',
            value: [
              "`/about` — Discover the Kingdom's identity and meet Leone.",
              '`/staff` — Meet Supreme Royalty, admins, and moderators.',
              '`/server-map` — Browse categories and channels you can access.',
              '`/rules` — Find the official rules and community guidelines.',
            ].join('\n'),
          },
          {
            name: '⚙️ Leone utilities',
            value: [
              '`/help` — Display this command guide.',
              '`/server` — View live server information.',
              '`/ping` — Check Leone response and WebSocket latency.',
            ].join('\n'),
          },
        )
        .setFooter({
          text: "Leone • Royal Companion of Leonore's Kingdom",
        });

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'about': {
      const botUser = interaction.client.user;

      const embed = new EmbedBuilder()
        .setColor(0x1b2a4e)
        .setTitle("👑 Leonore's Kingdom")
        .setDescription(
          [
            '**Home for Talented People, Safe Space for Citizen**',
            '',
            '**WE BELONG TOGETHER**',
            '> *"It\'s not just a community, it\'s a palace to reach your dreams and ur safe haven~"*',
          ].join('\n'),
        )
        .setThumbnail(botUser.displayAvatarURL({ size: 256 }))
        .addFields(
          {
            name: '✨ Our traits',
            value: [
              '🎨 **Talented** — A home for people to create, play, share, and shine.',
              '🧠 **Growth mindset** — Learn together and keep becoming better.',
              '🛡️ **Safe space** — A welcoming haven where every citizen can belong.',
            ].join('\n'),
          },
          {
            name: '🎮 Games in the Kingdom',
            value: [
              'Mobile Legends: Bang Bang • Dota 2 • Genshin Impact',
              'Roblox • Valorant • Honkai: Star Rail • osu!',
            ].join('\n'),
          },
          {
            name: '💙 The heart of the Kingdom',
            value: [
              `Founded and led by **Leonore**, with <@${LEANNE_USER_ID}> — **Leanne, his beloved girlfriend and royal partner** — beside him.`,
              'The staff team helps protect our safe space and keeps the Kingdom welcoming and organized.',
            ].join('\n'),
          },
          {
            name: '🤖 Meet Leone',
            value: [
              "I'm the Kingdom's royal companion and guide.",
              'As I grow, I will help members navigate the server, meet the staff, build social bonds, discover games and movies, research technical topics, join activities, and support community safety.',
            ].join(' '),
          },
          {
            name: 'Start exploring',
            value: 'Use `/help` to see what Leone can do today.',
          },
        )
        .setFooter({
          text: "Leone • Royal Companion of Leonore's Kingdom",
        });

      await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
      break;
    }

    case 'staff': {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: 'This command can only be used inside a server.',
        });

        return;
      }

      const guild = interaction.guild;
      const supremeRoyaltyRole = findRoleByName(guild, [
        'Supreme Royalty',
      ]);
      const adminRole = findRoleByName(guild, [
        'Admin',
        'Administrator',
      ]);
      const moderatorRole = findRoleByName(guild, [
        'Moderator',
        'Mod',
      ]);

      const embed = new EmbedBuilder()
        .setColor(KINGDOM_COLOR)
        .setTitle('👑 Meet the Kingdom Team')
        .setDescription(
          'The live Discord role hierarchy determines staff authority. Relationship lore never grants permissions.',
        )
        .setThumbnail(
          guild.iconURL({ size: 256 }) ??
            interaction.client.user.displayAvatarURL({ size: 256 }),
        )
        .addFields(
          {
            name: '👑 Supreme Royalty',
            value: [
              formatRole(
                supremeRoyaltyRole,
                'Supreme Royalty',
              ),
              `<@${guild.ownerId}> — **Leonore**, Owner & Founder`,
              `<@${LEANNE_USER_ID}> — **Leanne**, Leonore’s Girlfriend & Royal Partner`,
              "Together, they represent the Kingdom's highest royal leadership.",
            ].join('\n'),
          },
          {
            name: '🛡️ Administrators',
            value: [
              formatRole(adminRole, 'Admin'),
              'Oversee server operations, structure, and escalated community concerns.',
            ].join('\n'),
          },
          {
            name: '⚖️ Moderators',
            value: [
              formatRole(moderatorRole, 'Moderator'),
              'Help enforce the rules and protect the Kingdom as a welcoming safe space.',
            ].join('\n'),
          },
        )
        .setFooter({
          text: 'Use the appropriate staff role when you need assistance.',
        });

      await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
      break;
    }

    case 'server-map': {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: 'This command can only be used inside a server.',
        });

        return;
      }

      await interaction.deferReply();

      const embeds = buildServerMapEmbeds(
        interaction.guild,
        interaction.member,
      );

      await interaction.editReply({
        embeds: [embeds[0]],
        components: buildServerMapComponents(
          interaction.user.id,
          0,
          embeds.length,
        ),
        allowedMentions: { parse: [] },
      });
      break;
    }

    case 'rules': {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: 'This command can only be used inside a server.',
        });

        return;
      }

      const guild = interaction.guild;
      const rulesChannel = findRulesChannel(
        guild,
        interaction.member,
      );
      const adminRole = findRoleByName(guild, [
        'Admin',
        'Administrator',
      ]);
      const moderatorRole = findRoleByName(guild, [
        'Moderator',
        'Mod',
      ]);
      const embed = new EmbedBuilder()
        .setColor(KINGDOM_COLOR)
        .setTitle('📜 Kingdom Rules');

      if (rulesChannel) {
        embed
          .setDescription(
            `The official rules for **${guild.name}** are published in <#${rulesChannel.id}>.`,
          )
          .addFields({
            name: 'Before participating',
            value: [
              'Please read the complete rules in that channel.',
              'By participating, every citizen is expected to respect the community and help protect its safe-space values.',
            ].join('\n'),
          });
      } else {
        embed
          .setDescription(
            'I could not find a rules channel that is currently visible to you.',
          )
          .addFields({
            name: 'Need help?',
            value: `Please contact ${formatRole(adminRole, 'Admin')} or ${formatRole(moderatorRole, 'Moderator')} for the official guidelines.`,
          });
      }

      embed.setFooter({
        text: 'Canonical rules come from the server, not generated text.',
      });

      await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
      break;
    }

    case 'server': {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: 'This command can only be used inside a server.',
        });

        return;
      }

      const guild = interaction.guild;
      const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(guild.name)
        .setThumbnail(
          guild.iconURL({ size: 256 }) ??
            interaction.client.user.displayAvatarURL({
              size: 256,
            }),
        )
        .addFields(
          {
            name: 'Members',
            value: String(guild.memberCount),
            inline: true,
          },
          {
            name: 'Channels',
            value: String(guild.channels.cache.size),
            inline: true,
          },
          {
            name: 'Roles',
            value: String(guild.roles.cache.size),
            inline: true,
          },
          {
            name: 'Owner',
            value: `<@${guild.ownerId}>`,
            inline: true,
          },
          {
            name: 'Created',
            value: `<t:${createdTimestamp}:D>`,
            inline: true,
          },
          {
            name: 'Server ID',
            value: guild.id,
            inline: true,
          },
        );

      await interaction.reply({ embeds: [embed] });
      break;
    }

    default:
      throw new Error(`Unsupported command: ${interaction.commandName}`);
  }
}

/**
 * Execute a Leone button interaction.
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} Whether Leone handled the button.
 */
async function executeButton(interaction) {
  const [prefix, requesterId, requestedPageValue] =
    interaction.customId.split(':');

  if (
    prefix !== SERVER_MAP_BUTTON_PREFIX ||
    !requesterId ||
    requestedPageValue === undefined
  ) {
    return false;
  }

  if (interaction.user.id !== requesterId) {
    await interaction.reply({
      content: 'Only the member who opened this map can change its page.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This map is no longer available inside a server.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  await interaction.deferUpdate();

  const embeds = buildServerMapEmbeds(
    interaction.guild,
    interaction.member,
  );
  const requestedPage = Number.parseInt(requestedPageValue, 10);
  const pageIndex = Number.isInteger(requestedPage)
    ? Math.min(Math.max(requestedPage, 0), embeds.length - 1)
    : 0;

  await interaction.editReply({
    embeds: [embeds[pageIndex]],
    components: buildServerMapComponents(
      requesterId,
      pageIndex,
      embeds.length,
    ),
    allowedMentions: { parse: [] },
  });

  return true;
}

module.exports = {
  commands,
  executeButton,
  executeCommand,
};
