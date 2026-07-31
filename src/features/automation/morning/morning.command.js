const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const {
  BmkgError,
  createBmkgClient,
} = require('./bmkg-client');
const {
  buildMorningMessage,
} = require('./morning-message');

function addMorningOptions(subcommand) {
  return subcommand
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Role addressed by the greeting.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('adm4')
        .setDescription(
          'Optional BMKG village code, such as 31.71.03.1001.',
        )
        .setMaxLength(20),
    )
    .addStringOption((option) =>
      option
        .setName('location')
        .setDescription(
          'Optional display name that overrides the BMKG location.',
        )
        .setMaxLength(100),
    );
}

const data = new SlashCommandBuilder()
  .setName('morning')
  .setDescription('Create a royal good-morning greeting.')
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ManageGuild,
  )
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    addMorningOptions(
      subcommand
        .setName('preview')
        .setDescription(
          'Privately preview the greeting without pinging.',
        ),
    ),
  )
  .addSubcommand((subcommand) =>
    addMorningOptions(
      subcommand
        .setName('send')
        .setDescription(
          'Post the greeting and notify the selected role.',
        ),
    ),
  );

const help = {
  area: 'automation',
  usage: '/morning preview|send role:<role> [weather]',
  summary:
    'Preview or manually post the Kingdom morning greeting.',
  audience: 'staff',
  order: 10,
};

function canManageMorning(interaction) {
  return Boolean(
    interaction.inGuild() &&
      (interaction.guild.ownerId === interaction.user.id ||
        interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageGuild,
        )),
  );
}

async function loadWeather(interaction, options = {}) {
  const adm4 =
    interaction.options.getString('adm4') ??
    process.env.BMKG_ADM4;

  if (!adm4) {
    return {
      error: null,
      weather: null,
    };
  }

  try {
    const client =
      options.bmkgClient ?? createBmkgClient();

    return {
      error: null,
      weather: await client.getForecast(adm4),
    };
  } catch (error) {
    if (!(error instanceof BmkgError)) {
      throw error;
    }

    console.warn(
      `Morning greeting is using generic weather fallback: ${error.message}`,
    );

    return {
      error,
      weather: null,
    };
  }
}

function getWeatherNotice(error) {
  if (!error) {
    return null;
  }

  if (error.code === 'INVALID_LOCATION') {
    return 'BMKG weather was skipped because the ADM4 code is invalid. Use the format `00.00.00.0000`.';
  }

  return 'BMKG weather is temporarily unavailable, so Leone used the weather-neutral fallback.';
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{bmkgClient?: {getForecast: Function}, date?: Date}} options
 */
async function executeMorning(interaction, options = {}) {
  if (!canManageMorning(interaction)) {
    await interaction.reply({
      content:
        'Only the server owner or members with Manage Server can use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const role = interaction.options.getRole('role', true);

  if (role.id === interaction.guild.id) {
    await interaction.reply({
      content:
        'Choose a dedicated role instead of `@everyone` for the morning greeting.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const { error, weather } = await loadWeather(
    interaction,
    options,
  );
  const locationLabel =
    interaction.options.getString('location') ??
    process.env.MORNING_LOCATION ??
    null;
  const content = buildMorningMessage({
    date: options.date,
    locationLabel,
    roleMention: `<@&${role.id}>`,
    weather,
  });
  const weatherNotice = getWeatherNotice(error);

  if (subcommand === 'preview') {
    await interaction.editReply({
      content: [
        '**Preview — the selected role was not notified**',
        '',
        content,
        weatherNotice ? `\n⚠️ ${weatherNotice}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (
    !interaction.channel?.isTextBased() ||
    typeof interaction.channel.send !== 'function'
  ) {
    await interaction.editReply({
      content:
        'Leone cannot post the greeting in this channel.',
    });
    return;
  }

  const canMentionRole =
    role.mentionable ||
    interaction.appPermissions?.has(
      PermissionFlagsBits.MentionEveryone,
    );

  if (!canMentionRole) {
    await interaction.editReply({
      content:
        'Leone cannot notify that role. Make it mentionable or grant Leone `Mention Everyone` in this channel, then try again.',
    });
    return;
  }

  const message = await interaction.channel.send({
    content,
    allowedMentions: {
      roles: [role.id],
      users: [],
      repliedUser: false,
    },
  });

  await interaction.editReply({
    content: [
      `Morning greeting sent successfully: ${message.url}`,
      weatherNotice ? `⚠️ ${weatherNotice}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

async function execute(interaction) {
  await executeMorning(interaction);
}

module.exports = {
  addMorningOptions,
  canManageMorning,
  data,
  execute,
  executeMorning,
  getWeatherNotice,
  help,
  loadWeather,
};
