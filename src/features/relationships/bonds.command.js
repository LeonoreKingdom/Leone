const {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const { KINGDOM_COLOR } = require('../../shared/constants');
const {
  BOND_TYPE_CHOICES,
  BondError,
  BondService,
  PRIVACY_CHOICES,
} = require('./bond-service');
const { JsonBondStore } = require('./bond-store');

const defaultService = new BondService({
  store: new JsonBondStore(),
});

const typeLabels = Object.fromEntries(
  BOND_TYPE_CHOICES.map((choice) => [
    choice.value,
    choice.name.replace(/\s+\(.*\)$/, ''),
  ]),
);

const privacyLabels = Object.fromEntries(
  PRIVACY_CHOICES.map((choice) => [
    choice.value,
    choice.name.split(' — ')[0],
  ]),
);

const data = new SlashCommandBuilder()
  .setName('bonds')
  .setDescription(
    'Create and manage consensual social bonds in the Kingdom.',
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('request')
      .setDescription('Privately request a bond with another member.')
      .addUserOption((option) =>
        option
          .setName('member')
          .setDescription('The member you want to bond with.')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('The relationship you are requesting.')
          .setRequired(true)
          .addChoices(...BOND_TYPE_CHOICES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('pending')
      .setDescription('Review your incoming and outgoing requests.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('accept')
      .setDescription('Accept one of your pending bond requests.')
      .addStringOption((option) =>
        option
          .setName('request-id')
          .setDescription('The request ID shown by /bonds pending.')
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(64),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('decline')
      .setDescription('Decline one of your pending bond requests.')
      .addStringOption((option) =>
        option
          .setName('request-id')
          .setDescription('The request ID shown by /bonds pending.')
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(64),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('tree')
      .setDescription('View a bond tree allowed by its privacy settings.')
      .addUserOption((option) =>
        option
          .setName('member')
          .setDescription('Whose tree to view; defaults to yours.')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('unlink')
      .setDescription('Remove one of your existing bonds.')
      .addUserOption((option) =>
        option
          .setName('member')
          .setDescription('The member to unlink from.')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription(
            'Required only when you share multiple bond types.',
          )
          .setRequired(false)
          .addChoices(...BOND_TYPE_CHOICES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('privacy')
      .setDescription('Control who can inspect your bond tree.')
      .addStringOption((option) =>
        option
          .setName('visibility')
          .setDescription('Who may inspect your tree.')
          .setRequired(true)
          .addChoices(...PRIVACY_CHOICES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('block')
      .setDescription(
        'Block bond requests and remove current bonds with a member.',
      )
      .addUserOption((option) =>
        option
          .setName('member')
          .setDescription('The member to block.')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('unblock')
      .setDescription('Allow future bond requests from a member.')
      .addUserOption((option) =>
        option
          .setName('member')
          .setDescription('The member to unblock.')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('export')
      .setDescription('Export your Bonds data as a private JSON file.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete-data')
      .setDescription('Permanently erase your Bonds data.')
      .addBooleanOption((option) =>
        option
          .setName('confirm')
          .setDescription(
            'Confirm deletion of your requests, bonds, and settings.',
          )
          .setRequired(true),
      ),
  );

const help = {
  area: 'relationships',
  usage: '/bonds <action>',
  summary:
    'Request, accept, view, unlink, protect, export, or erase social bonds.',
  audience: 'everyone',
  order: 10,
};

function packLines(lines, maximumLength = 900) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length > maximumLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function formatRequest(request, direction) {
  const memberId =
    direction === 'incoming'
      ? request.requesterId
      : request.targetId;
  const expiresTimestamp = Math.floor(
    request.expiresAt / 1000,
  );

  return [
    `\`${request.id}\``,
    `<@${memberId}>`,
    `**${typeLabels[request.requestedType]}**`,
    `expires <t:${expiresTimestamp}:R>`,
  ].join(' • ');
}

function createRequestFields(requests) {
  const fields = [];

  for (const [label, requestList, direction] of [
    ['Incoming requests', requests.incoming, 'incoming'],
    ['Outgoing requests', requests.outgoing, 'outgoing'],
  ]) {
    const lines = requestList
      .slice(0, 30)
      .map((request) => formatRequest(request, direction));
    const chunks = packLines(
      lines.length > 0 ? lines : ['None'],
    );

    for (const [index, value] of chunks.entries()) {
      fields.push({
        name: index === 0 ? label : `${label} (continued)`,
        value,
      });
    }
  }

  return fields;
}

function createTreeFields(relationships) {
  if (relationships.length === 0) {
    return [
      {
        name: 'Visible bonds',
        value: 'No bonds are visible in this tree.',
      },
    ];
  }

  const lines = relationships
    .slice(0, 100)
    .map(
      (relationship) =>
        `<@${relationship.otherUserId}> — **${relationship.label}**`,
    );
  const chunks = packLines(lines);

  return chunks.map((value, index) => ({
    name:
      index === 0
        ? 'Visible bonds'
        : 'Visible bonds (continued)',
    value,
  }));
}

/**
 * Build the command module with an injectable service for tests.
 *
 * @param {BondService} service
 */
function createBondsCommand(service = defaultService) {
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async function execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Bonds can only be managed inside a server.',
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    try {
      switch (subcommand) {
        case 'request': {
          const target = interaction.options.getUser(
            'member',
            true,
          );
          const requestedType = interaction.options.getString(
            'type',
            true,
          );
          const request = await service.createRequest({
            guildId,
            requesterId: userId,
            targetId: target.id,
            requestedType,
            targetIsBot: target.bot,
          });
          let notificationDelivered = true;

          try {
            await target.send({
              content: [
                `You received a **${typeLabels[requestedType]}** bond request from <@${userId}> in **${interaction.guild.name}**.`,
                `Request ID: \`${request.id}\``,
                'Use `/bonds pending`, then `/bonds accept` or `/bonds decline` inside the server.',
                'No bond exists unless you explicitly accept.',
              ].join('\n'),
              allowedMentions: { parse: [] },
            });
          } catch {
            notificationDelivered = false;
          }

          await interaction.editReply({
            content: [
              `Your **${typeLabels[requestedType]}** request for <@${target.id}> is pending consent.`,
              `Request ID: \`${request.id}\``,
              notificationDelivered
                ? 'Leone sent the member a private notification.'
                : 'Their DMs are unavailable; they can still find it with `/bonds pending`.',
              'The request expires automatically after 7 days.',
            ].join('\n'),
            allowedMentions: { parse: [] },
          });
          break;
        }

        case 'pending': {
          const requests = await service.listRequests({
            guildId,
            userId,
          });
          const embed = new EmbedBuilder()
            .setColor(KINGDOM_COLOR)
            .setTitle('🤝 Pending Bond Requests')
            .setDescription(
              'Requests create no relationship until the recipient accepts.',
            )
            .addFields(createRequestFields(requests))
            .setFooter({
              text: 'Pending requests expire automatically after 7 days.',
            });

          await interaction.editReply({
            embeds: [embed],
            allowedMentions: { parse: [] },
          });
          break;
        }

        case 'accept': {
          const requestId = interaction.options.getString(
            'request-id',
            true,
          );
          const result = await service.acceptRequest({
            guildId,
            userId,
            requestId,
          });

          await interaction.editReply({
            content: [
              `Bond accepted with <@${result.request.requesterId}>.`,
              `Relationship: **${typeLabels[result.request.requestedType]}**.`,
              'Social bonds never grant Discord roles or permissions.',
            ].join('\n'),
            allowedMentions: { parse: [] },
          });
          break;
        }

        case 'decline': {
          const requestId = interaction.options.getString(
            'request-id',
            true,
          );

          await service.declineRequest({
            guildId,
            userId,
            requestId,
          });
          await interaction.editReply({
            content:
              'The request was declined and deleted. No bond was created.',
          });
          break;
        }

        case 'tree': {
          const member =
            interaction.options.getUser('member') ??
            interaction.user;
          const tree = await service.getTree({
            guildId,
            viewerId: userId,
            memberId: member.id,
          });
          const embed = new EmbedBuilder()
            .setColor(KINGDOM_COLOR)
            .setTitle(`🌳 ${member.displayName}'s Bond Tree`)
            .setDescription(
              `Visibility: **${privacyLabels[tree.visibility]}**\nOnly direct relationships allowed by every participant’s privacy setting are shown.`,
            )
            .addFields(
              createTreeFields(tree.relationships),
            )
            .setFooter({
              text: 'Bonds are social lore and never inherit Discord permissions.',
            });

          await interaction.editReply({
            embeds: [embed],
            allowedMentions: { parse: [] },
          });
          break;
        }

        case 'unlink': {
          const target = interaction.options.getUser(
            'member',
            true,
          );
          const requestedType =
            interaction.options.getString('type');

          await service.unlink({
            guildId,
            userId,
            targetId: target.id,
            requestedType,
          });
          await interaction.editReply({
            content: `Your selected bond with <@${target.id}> was removed.`,
            allowedMentions: { parse: [] },
          });
          break;
        }

        case 'privacy': {
          const visibility = interaction.options.getString(
            'visibility',
            true,
          );

          await service.setPrivacy({
            guildId,
            userId,
            visibility,
          });
          await interaction.editReply({
            content: `Your bond-tree visibility is now **${privacyLabels[visibility]}**.`,
          });
          break;
        }

        case 'block': {
          const target = interaction.options.getUser(
            'member',
            true,
          );
          const result = await service.block({
            guildId,
            userId,
            targetId: target.id,
          });

          await interaction.editReply({
            content: [
              `<@${target.id}> can no longer send you bond requests.`,
              `Removed pending requests: **${result.removedRequests}**`,
              `Removed existing bonds: **${result.removedEdges}**`,
            ].join('\n'),
            allowedMentions: { parse: [] },
          });
          break;
        }

        case 'unblock': {
          const target = interaction.options.getUser(
            'member',
            true,
          );
          const wasBlocked = await service.unblock({
            guildId,
            userId,
            targetId: target.id,
          });

          await interaction.editReply({
            content: wasBlocked
              ? `<@${target.id}> may send you bond requests again.`
              : `<@${target.id}> was not on your Bonds block list.`,
            allowedMentions: { parse: [] },
          });
          break;
        }

        case 'export': {
          const exportedData = await service.exportUserData({
            guildId,
            userId,
          });
          const attachment = new AttachmentBuilder(
            Buffer.from(
              `${JSON.stringify(exportedData, null, 2)}\n`,
              'utf8',
            ),
            {
              name: `leone-bonds-${userId}.json`,
              description:
                'Your private Leone Bonds data export.',
            },
          );

          await interaction.editReply({
            content:
              'Here is your private Leone Bonds data export.',
            files: [attachment],
          });
          break;
        }

        case 'delete-data': {
          const confirmed = interaction.options.getBoolean(
            'confirm',
            true,
          );

          if (!confirmed) {
            await interaction.editReply({
              content:
                'Deletion was not confirmed. Your Bonds data is unchanged.',
            });
            break;
          }

          const result = await service.eraseUserData({
            guildId,
            userId,
          });

          await interaction.editReply({
            content: [
              'Your Leone Bonds data for this server was permanently erased.',
              `Removed requests: **${result.removedRequests}**`,
              `Removed bonds: **${result.removedEdges}**`,
              'No relationship history is retained by Bonds.',
            ].join('\n'),
          });
          break;
        }

        default:
          throw new Error(
            `Unsupported bonds subcommand: ${subcommand}`,
          );
      }
    } catch (error) {
      if (!(error instanceof BondError)) {
        throw error;
      }

      await interaction.editReply({
        content: `Unable to complete that Bonds action: ${error.message}`,
      });
    }
  }

  return {
    data,
    execute,
    help,
  };
}

module.exports = createBondsCommand();
module.exports.createBondsCommand = createBondsCommand;
