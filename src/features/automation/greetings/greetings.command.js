const {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const { getPool } = require('../../../db/pool');
const { AuditRepository } = require('../../../db/audit-repository');
const { KINGDOM_COLOR } = require('../../../shared/constants');
const { BmkgError, createBmkgClient } = require('../morning/bmkg-client');
const { OCCASIONS, buildGreetingMessage } = require('./greeting-message');
const { GreetingRepository } = require('./greeting-repository');

const occasionChoices = OCCASIONS.map((occasion) => ({
  name: occasion[0].toUpperCase() + occasion.slice(1),
  value: occasion,
}));

function addMessageOptions(subcommand) {
  return subcommand
    .addRoleOption((option) =>
      option.setName('role').setDescription('Opt-in role addressed by the greeting.').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('occasion').setDescription('Greeting occasion.').setRequired(true).addChoices(...occasionChoices),
    )
    .addStringOption((option) =>
      option.setName('adm4').setDescription('Optional BMKG village code.').setMaxLength(20),
    )
    .addStringOption((option) =>
      option.setName('location').setDescription('Optional public location label.').setMaxLength(100),
    );
}

const data = new SlashCommandBuilder()
  .setName('greetings')
  .setDescription('Create and schedule royal Kingdom greetings.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommandGroup((group) =>
    group
      .setName('message')
      .setDescription('Preview or send a greeting now.')
      .addSubcommand((subcommand) =>
        addMessageOptions(subcommand.setName('preview').setDescription('Preview privately without pinging.')),
      )
      .addSubcommand((subcommand) =>
        addMessageOptions(subcommand.setName('send').setDescription('Send now and notify one opt-in role.')),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('schedule')
      .setDescription('Manage opt-in greeting schedules.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('create')
          .setDescription('Create a disabled schedule for review.')
          .addStringOption((option) => option.setName('name').setDescription('Unique schedule name.').setRequired(true).setMaxLength(80))
          .addChannelOption((option) => option.setName('channel').setDescription('Destination channel.').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
          .addRoleOption((option) => option.setName('role').setDescription('Opt-in greeting role.').setRequired(true))
          .addStringOption((option) => option.setName('occasion').setDescription('Greeting occasion.').setRequired(true).addChoices(...occasionChoices))
          .addStringOption((option) => option.setName('time').setDescription('Local time in HH:mm format.').setRequired(true).setMinLength(5).setMaxLength(5))
          .addStringOption((option) => option.setName('days').setDescription('ISO days 1-7, comma separated; default every day.').setMaxLength(20))
          .addStringOption((option) => option.setName('timezone').setDescription('IANA timezone; defaults to Asia/Jakarta.').setMaxLength(64))
          .addStringOption((option) => option.setName('adm4').setDescription('Optional BMKG village code.').setMaxLength(20))
          .addStringOption((option) => option.setName('location').setDescription('Optional public location label.').setMaxLength(100)),
      )
      .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List schedules and their states.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('enable')
          .setDescription('Enable a reviewed schedule.')
          .addStringOption((option) => option.setName('name').setDescription('Schedule name or ID.').setRequired(true))
          .addBooleanOption((option) => option.setName('confirm').setDescription('Confirm role and channel delivery.').setRequired(true)),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('disable')
          .setDescription('Disable a schedule immediately.')
          .addStringOption((option) => option.setName('name').setDescription('Schedule name or ID.').setRequired(true)),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('delete')
          .setDescription('Delete a schedule and its run history.')
          .addStringOption((option) => option.setName('name').setDescription('Schedule name or ID.').setRequired(true))
          .addBooleanOption((option) => option.setName('confirm').setDescription('Confirm permanent deletion.').setRequired(true)),
      ),
  );

const help = {
  area: 'automation',
  usage: '/greetings message|schedule <action>',
  summary: 'Preview, send, and schedule opt-in Kingdom greetings.',
  audience: 'staff',
  order: 10,
};

function canManage(interaction) {
  return Boolean(
    interaction.inGuild() &&
      (interaction.guild.ownerId === interaction.user.id ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)),
  );
}

function parseDays(value) {
  if (!value) return [1, 2, 3, 4, 5, 6, 7];
  const days = [...new Set(value.split(',').map((item) => Number(item.trim())))];

  if (days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error('Days must be comma-separated ISO day numbers from 1 (Monday) to 7 (Sunday).');
  }
  return days.sort();
}

function validateTime(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error('Time must use 24-hour HH:mm format.');
  }
  return value;
}

function validateTimezone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    throw new Error('Timezone must be a valid IANA name, such as Asia/Jakarta.');
  }
}

async function loadWeather({ adm4, bmkgClient }) {
  if (!adm4) return { weather: null, warning: null };

  try {
    return {
      weather: await (bmkgClient ?? createBmkgClient()).getForecast(adm4),
      warning: null,
    };
  } catch (error) {
    if (!(error instanceof BmkgError)) throw error;
    return {
      weather: null,
      warning: 'BMKG weather was unavailable, so Leone used a neutral greeting.',
    };
  }
}

function getRepositories(options) {
  if (options.repository) {
    return {
      repository: options.repository,
      auditRepository: options.auditRepository ?? null,
    };
  }
  const pool = getPool();
  return {
    repository: new GreetingRepository(pool),
    auditRepository: new AuditRepository(pool),
  };
}

function createGreetingsCommand(options = {}) {
  async function execute(interaction) {
    if (!canManage(interaction)) {
      await interaction.reply({
        content: 'Only the server owner or members with Manage Server can use Greetings.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    if (group === 'message') {
      const role = interaction.options.getRole('role', true);

      if (role.id === interaction.guild.id) {
        await interaction.reply({
          content: 'Choose a dedicated opt-in role instead of `@everyone`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const occasion = interaction.options.getString('occasion', true);
      const adm4 = interaction.options.getString('adm4') ?? process.env.BMKG_ADM4;
      const locationLabel = interaction.options.getString('location') ?? process.env.GREETINGS_LOCATION;
      const { weather, warning } = await loadWeather({ adm4, bmkgClient: options.bmkgClient });
      const content = buildGreetingMessage({
        occasion,
        roleMention: `<@&${role.id}>`,
        weather,
        locationLabel,
        date: options.date,
      });

      if (subcommand === 'preview') {
        await interaction.editReply({
          content: ['**Private preview — no role was notified**', '', content, warning ? `\n⚠️ ${warning}` : null].filter(Boolean).join('\n'),
          allowedMentions: { parse: [] },
        });
        return;
      }

      const canMentionRole = role.mentionable || interaction.appPermissions?.has(PermissionFlagsBits.MentionEveryone);
      if (!canMentionRole || !interaction.channel?.isTextBased()) {
        await interaction.editReply({
          content: 'Leone cannot notify that role in this channel. Confirm channel access and role mentionability.',
        });
        return;
      }
      const message = await interaction.channel.send({
        content,
        allowedMentions: { roles: [role.id], users: [], repliedUser: false },
      });
      let auditRepository = null;
      try {
        auditRepository = getRepositories(options).auditRepository;
      } catch {}
      await auditRepository?.record({
        guildId: interaction.guildId,
        actorUserId: interaction.user.id,
        action: 'greeting.send_now',
        targetCategory: 'channel',
        targetId: interaction.channel.id,
        metadata: { roleId: role.id, occasion },
      });
      await interaction.editReply({
        content: [`Greeting sent successfully: ${message.url}`, warning ? `⚠️ ${warning}` : null].filter(Boolean).join('\n'),
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let repositories;
    try {
      repositories = getRepositories(options);
    } catch {
      await interaction.editReply('Database scheduling is not configured yet. Manual Greetings remains available.');
      return;
    }
    const { repository, auditRepository } = repositories;

    try {
      if (subcommand === 'create') {
        const role = interaction.options.getRole('role', true);
        const channel = interaction.options.getChannel('channel', true);
        if (role.id === interaction.guild.id) throw new Error('Schedules cannot notify `@everyone`.');
        const schedule = await repository.createSchedule({
          guildId: interaction.guildId,
          name: interaction.options.getString('name', true),
          channelId: channel.id,
          roleId: role.id,
          occasion: interaction.options.getString('occasion', true),
          localTime: validateTime(interaction.options.getString('time', true)),
          daysOfWeek: parseDays(interaction.options.getString('days')),
          timezone: validateTimezone(interaction.options.getString('timezone') ?? 'Asia/Jakarta'),
          adm4: interaction.options.getString('adm4'),
          locationLabel: interaction.options.getString('location'),
          graceMinutes: 15,
          actorUserId: interaction.user.id,
          name: interaction.options.getString('name', true),
          ownerUserId: interaction.guild.ownerId,
        });
        await auditRepository?.record({
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          action: 'greeting.schedule_create',
          targetCategory: 'schedule',
          targetId: schedule.id,
          metadata: { channelId: channel.id, roleId: role.id },
        });
        await interaction.editReply(`Schedule **${schedule.name}** was created disabled. Review it, then use \`/greetings schedule enable\`.`);
        return;
      }

      if (subcommand === 'list') {
        const schedules = await repository.listSchedules(interaction.guildId);
        const globalEnabled = await repository.getGlobalEnabled(interaction.guildId);
        const lines = schedules.map((schedule) =>
          `${schedule.enabled ? '🟢' : '⚪'} **${schedule.name}** — <#${schedule.channel_id}> · <@&${schedule.role_id}> · ${String(schedule.local_time).slice(0, 5)} ${schedule.timezone} · ${schedule.occasion}`,
        );
        const embed = new EmbedBuilder()
          .setColor(KINGDOM_COLOR)
          .setTitle('👑 Greeting Schedules')
          .setDescription(`Global scheduler: **${globalEnabled ? 'enabled' : 'disabled'}**\n${lines.length ? lines.join('\n') : 'No schedules configured.'}`)
          .setFooter({ text: 'New schedules are disabled by default.' });
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      }

      const identifier = interaction.options.getString('name', true);
      if (subcommand === 'enable') {
        if (!interaction.options.getBoolean('confirm', true)) {
          await interaction.editReply('Enable was not confirmed; nothing changed.');
          return;
        }
        const schedule = await repository.setScheduleEnabled({ guildId: interaction.guildId, identifier, enabled: true });
        if (!schedule) throw new Error('Schedule not found.');
        await repository.setGlobalEnabled(interaction.guildId, true);
        await auditRepository?.record({ guildId: interaction.guildId, actorUserId: interaction.user.id, action: 'greeting.schedule_enable', targetCategory: 'schedule', targetId: schedule.id });
        await interaction.editReply(`Schedule **${schedule.name}** is enabled for <#${schedule.channel_id}> and <@&${schedule.role_id}>.`);
        return;
      }

      if (subcommand === 'disable') {
        const schedule = await repository.setScheduleEnabled({ guildId: interaction.guildId, identifier, enabled: false });
        if (!schedule) throw new Error('Schedule not found.');
        await auditRepository?.record({ guildId: interaction.guildId, actorUserId: interaction.user.id, action: 'greeting.schedule_disable', targetCategory: 'schedule', targetId: schedule.id });
        await interaction.editReply(`Schedule **${schedule.name}** is disabled.`);
        return;
      }

      if (subcommand === 'delete') {
        if (!interaction.options.getBoolean('confirm', true)) {
          await interaction.editReply('Deletion was not confirmed; nothing changed.');
          return;
        }
        const schedule = await repository.deleteSchedule({ guildId: interaction.guildId, identifier });
        if (!schedule) throw new Error('Schedule not found.');
        await auditRepository?.record({ guildId: interaction.guildId, actorUserId: interaction.user.id, action: 'greeting.schedule_delete', targetCategory: 'schedule', targetId: schedule.id });
        await interaction.editReply(`Schedule **${schedule.name}** and its run history were deleted.`);
        return;
      }

      throw new Error(`Unsupported Greetings action: ${subcommand}`);
    } catch (error) {
      await interaction.editReply(`Unable to complete that Greetings action: ${error.message}`);
    }
  }

  return { data, execute, help };
}

module.exports = createGreetingsCommand();
module.exports.createGreetingsCommand = createGreetingsCommand;
module.exports.parseDays = parseDays;
module.exports.validateTime = validateTime;
module.exports.validateTimezone = validateTimezone;
