const { randomUUID } = require('node:crypto');

const REQUEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_VISIBILITY = 'private';
const DIRECTED_TYPES = new Set(['parent', 'mentor']);

const BOND_TYPE_CHOICES = [
  { name: 'Partner', value: 'partner' },
  { name: 'Parent (I am their parent)', value: 'parent' },
  { name: 'Child (I am their child)', value: 'child' },
  { name: 'Sibling', value: 'sibling' },
  { name: 'Best Friend', value: 'best-friend' },
  { name: 'Mentor (I am their mentor)', value: 'mentor' },
  { name: 'Apprentice (I am their apprentice)', value: 'apprentice' },
  { name: 'Friendly Rival', value: 'friendly-rival' },
  { name: 'Found Family', value: 'found-family' },
];

const PRIVACY_CHOICES = [
  { name: 'Private — only me', value: 'private' },
  {
    name: 'Bonds — people directly bonded with me',
    value: 'bonds',
  },
  { name: 'Public — any server member', value: 'public' },
];

class BondError extends Error {
  constructor(message, code = 'BOND_ERROR', details = {}) {
    super(message);
    this.name = 'BondError';
    this.code = code;
    this.details = details;
  }
}

function memberKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getProfile(state, guildId, userId) {
  return (
    state.members[memberKey(guildId, userId)] ?? {
      visibility: DEFAULT_VISIBILITY,
      blockedUserIds: [],
    }
  );
}

function ensureProfile(state, guildId, userId) {
  const key = memberKey(guildId, userId);

  if (!state.members[key]) {
    state.members[key] = {
      visibility: DEFAULT_VISIBILITY,
      blockedUserIds: [],
    };
  }

  return state.members[key];
}

function normalizeRelationship(
  requestedType,
  requesterId,
  targetId,
) {
  switch (requestedType) {
    case 'child':
      return {
        type: 'parent',
        fromId: targetId,
        toId: requesterId,
      };
    case 'apprentice':
      return {
        type: 'mentor',
        fromId: targetId,
        toId: requesterId,
      };
    case 'parent':
    case 'mentor':
      return {
        type: requestedType,
        fromId: requesterId,
        toId: targetId,
      };
    case 'partner':
    case 'sibling':
    case 'best-friend':
    case 'friendly-rival':
    case 'found-family': {
      const [fromId, toId] = [
        requesterId,
        targetId,
      ].sort();

      return {
        type: requestedType,
        fromId,
        toId,
      };
    }
    default:
      throw new BondError(
        'That bond type is not supported.',
        'INVALID_TYPE',
      );
  }
}

function purgeExpiredRequests(state, now) {
  state.requests = state.requests.filter(
    (request) => request.expiresAt > now,
  );
}

function isSameRelationship(left, right) {
  return (
    left.type === right.type &&
    left.fromId === right.fromId &&
    left.toId === right.toId
  );
}

function isBetween(edge, firstUserId, secondUserId) {
  return (
    (edge.fromId === firstUserId &&
      edge.toId === secondUserId) ||
    (edge.fromId === secondUserId &&
      edge.toId === firstUserId)
  );
}

function wouldCreateCycle(
  edges,
  guildId,
  relationship,
) {
  if (!DIRECTED_TYPES.has(relationship.type)) {
    return false;
  }

  const adjacency = new Map();

  for (const edge of edges) {
    if (
      edge.guildId !== guildId ||
      edge.type !== relationship.type
    ) {
      continue;
    }

    const children = adjacency.get(edge.fromId) ?? [];
    children.push(edge.toId);
    adjacency.set(edge.fromId, children);
  }

  const pending = [relationship.toId];
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === relationship.fromId) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }

  return false;
}

function relationshipLabel(edge, userId) {
  switch (edge.type) {
    case 'partner':
      return 'Partner';
    case 'parent':
      return edge.fromId === userId ? 'Child' : 'Parent';
    case 'sibling':
      return 'Sibling';
    case 'best-friend':
      return 'Best Friend';
    case 'mentor':
      return edge.fromId === userId
        ? 'Apprentice'
        : 'Mentor';
    case 'friendly-rival':
      return 'Friendly Rival';
    case 'found-family':
      return 'Found Family';
    default:
      return 'Bond';
  }
}

function hasBondBetween(state, guildId, firstUserId, secondUserId) {
  return state.edges.some(
    (edge) =>
      edge.guildId === guildId &&
      isBetween(edge, firstUserId, secondUserId),
  );
}

function canViewMember(
  state,
  guildId,
  viewerId,
  memberId,
) {
  if (viewerId === memberId) {
    return true;
  }

  const profile = getProfile(state, guildId, memberId);

  if (profile.visibility === 'public') {
    return true;
  }

  return (
    profile.visibility === 'bonds' &&
    hasBondBetween(state, guildId, viewerId, memberId)
  );
}

class BondService {
  /**
   * @param {{store: {read: Function, transact: Function}, now?: () => number, createId?: () => string}} options
   */
  constructor(options) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async createRequest({
    guildId,
    requesterId,
    targetId,
    requestedType,
    targetIsBot = false,
  }) {
    if (requesterId === targetId) {
      throw new BondError(
        'You cannot create a bond with yourself.',
        'SELF_LINK',
      );
    }

    if (targetIsBot) {
      throw new BondError(
        'Bonds can only be created with human server members.',
        'BOT_TARGET',
      );
    }

    const relationship = normalizeRelationship(
      requestedType,
      requesterId,
      targetId,
    );

    return this.store.transact((state) => {
      const now = this.now();
      purgeExpiredRequests(state, now);

      const requesterProfile = getProfile(
        state,
        guildId,
        requesterId,
      );
      const targetProfile = getProfile(
        state,
        guildId,
        targetId,
      );

      if (
        requesterProfile.blockedUserIds.includes(targetId) ||
        targetProfile.blockedUserIds.includes(requesterId)
      ) {
        throw new BondError(
          'This bond request cannot be created.',
          'BLOCKED',
        );
      }

      if (
        state.edges.some(
          (edge) =>
            edge.guildId === guildId &&
            isSameRelationship(edge, relationship),
        )
      ) {
        throw new BondError(
          'That bond already exists.',
          'DUPLICATE_EDGE',
        );
      }

      if (
        state.requests.some(
          (request) =>
            request.guildId === guildId &&
            isSameRelationship(request, relationship),
        )
      ) {
        throw new BondError(
          'An equivalent bond request is already pending.',
          'DUPLICATE_REQUEST',
        );
      }

      if (
        wouldCreateCycle(state.edges, guildId, relationship)
      ) {
        throw new BondError(
          'That relationship would create an invalid cycle.',
          'CYCLE',
        );
      }

      const request = {
        id: this.createId(),
        guildId,
        requesterId,
        targetId,
        requestedType,
        ...relationship,
        createdAt: now,
        expiresAt: now + REQUEST_RETENTION_MS,
      };

      state.requests.push(request);
      return request;
    });
  }

  async listRequests({ guildId, userId }) {
    return this.store.transact((state) => {
      const now = this.now();
      purgeExpiredRequests(state, now);

      return {
        incoming: state.requests.filter(
          (request) =>
            request.guildId === guildId &&
            request.targetId === userId,
        ),
        outgoing: state.requests.filter(
          (request) =>
            request.guildId === guildId &&
            request.requesterId === userId,
        ),
      };
    });
  }

  async acceptRequest({
    guildId,
    userId,
    requestId = null,
    requesterId = null,
    requestedType = null,
  }) {
    return this.store.transact((state) => {
      const now = this.now();
      purgeExpiredRequests(state, now);

      const candidates = state.requests
        .map((request, index) => ({ request, index }))
        .filter(
          ({ request }) =>
            request.guildId === guildId &&
            request.targetId === userId &&
            (requestId ? request.id === requestId : true) &&
            (requesterId
              ? request.requesterId === requesterId
              : true) &&
            (requestedType
              ? request.requestedType === requestedType
              : true),
        );

      if (candidates.length > 1 && !requestId && !requestedType) {
        throw new BondError(
          'That member sent multiple request types. Choose the bond type.',
          'TYPE_REQUIRED',
          {
            types: candidates.map(
              ({ request }) => request.requestedType,
            ),
          },
        );
      }

      const requestIndex = candidates[0]?.index ?? -1;
      const request = state.requests[requestIndex];

      if (!request || request.targetId !== userId) {
        throw new BondError(
          'That pending request was not found.',
          'REQUEST_NOT_FOUND',
        );
      }

      const requesterProfile = getProfile(
        state,
        guildId,
        request.requesterId,
      );
      const targetProfile = getProfile(
        state,
        guildId,
        request.targetId,
      );

      if (
        requesterProfile.blockedUserIds.includes(
          request.targetId,
        ) ||
        targetProfile.blockedUserIds.includes(
          request.requesterId,
        )
      ) {
        throw new BondError(
          'This bond request can no longer be accepted.',
          'BLOCKED',
        );
      }

      if (
        state.edges.some(
          (edge) =>
            edge.guildId === guildId &&
            isSameRelationship(edge, request),
        )
      ) {
        state.requests.splice(requestIndex, 1);
        throw new BondError(
          'That bond already exists.',
          'DUPLICATE_EDGE',
        );
      }

      if (wouldCreateCycle(state.edges, guildId, request)) {
        throw new BondError(
          'That relationship would create an invalid cycle.',
          'CYCLE',
        );
      }

      const edge = {
        id: this.createId(),
        guildId,
        type: request.type,
        fromId: request.fromId,
        toId: request.toId,
        createdAt: now,
      };

      state.edges.push(edge);
      state.requests.splice(requestIndex, 1);

      return {
        edge,
        request,
      };
    });
  }

  async declineRequest({
    guildId,
    userId,
    requestId = null,
    requesterId = null,
    requestedType = null,
  }) {
    return this.store.transact((state) => {
      purgeExpiredRequests(state, this.now());

      const candidates = state.requests
        .map((request, index) => ({ request, index }))
        .filter(
          ({ request }) =>
            request.guildId === guildId &&
            request.targetId === userId &&
            (requestId ? request.id === requestId : true) &&
            (requesterId
              ? request.requesterId === requesterId
              : true) &&
            (requestedType
              ? request.requestedType === requestedType
              : true),
        );

      if (candidates.length > 1 && !requestId && !requestedType) {
        throw new BondError(
          'That member sent multiple request types. Choose the bond type.',
          'TYPE_REQUIRED',
          {
            types: candidates.map(
              ({ request }) => request.requestedType,
            ),
          },
        );
      }

      const requestIndex = candidates[0]?.index ?? -1;

      if (requestIndex < 0) {
        throw new BondError(
          'That pending request was not found.',
          'REQUEST_NOT_FOUND',
        );
      }

      const [request] = state.requests.splice(requestIndex, 1);
      return request;
    });
  }

  async unlink({
    guildId,
    userId,
    targetId,
    requestedType = null,
  }) {
    if (userId === targetId) {
      throw new BondError(
        'Choose another member to unlink.',
        'SELF_LINK',
      );
    }

    return this.store.transact((state) => {
      purgeExpiredRequests(state, this.now());

      let matches = state.edges
        .map((edge, index) => ({ edge, index }))
        .filter(
          ({ edge }) =>
            edge.guildId === guildId &&
            isBetween(edge, userId, targetId),
        );

      if (requestedType) {
        const normalized = normalizeRelationship(
          requestedType,
          userId,
          targetId,
        );
        matches = matches.filter(
          ({ edge }) => edge.type === normalized.type,
        );
      }

      if (matches.length === 0) {
        throw new BondError(
          'No matching bond was found.',
          'EDGE_NOT_FOUND',
        );
      }

      if (matches.length > 1 && !requestedType) {
        throw new BondError(
          'You share multiple bonds. Choose a bond type to unlink.',
          'TYPE_REQUIRED',
        );
      }

      const match = matches[0];
      state.edges.splice(match.index, 1);
      return match.edge;
    });
  }

  async setPrivacy({ guildId, userId, visibility }) {
    if (!PRIVACY_CHOICES.some((choice) => choice.value === visibility)) {
      throw new BondError(
        'That privacy setting is not supported.',
        'INVALID_VISIBILITY',
      );
    }

    return this.store.transact((state) => {
      purgeExpiredRequests(state, this.now());

      const profile = ensureProfile(state, guildId, userId);
      profile.visibility = visibility;
      return profile;
    });
  }

  async block({ guildId, userId, targetId }) {
    if (userId === targetId) {
      throw new BondError(
        'You cannot block yourself.',
        'SELF_BLOCK',
      );
    }

    return this.store.transact((state) => {
      purgeExpiredRequests(state, this.now());

      const profile = ensureProfile(state, guildId, userId);

      if (!profile.blockedUserIds.includes(targetId)) {
        profile.blockedUserIds.push(targetId);
      }

      const requestCountBefore = state.requests.length;
      const edgeCountBefore = state.edges.length;

      state.requests = state.requests.filter(
        (request) =>
          !(
            request.guildId === guildId &&
            ((request.requesterId === userId &&
              request.targetId === targetId) ||
              (request.requesterId === targetId &&
                request.targetId === userId))
          ),
      );
      state.edges = state.edges.filter(
        (edge) =>
          !(
            edge.guildId === guildId &&
            isBetween(edge, userId, targetId)
          ),
      );

      return {
        removedRequests:
          requestCountBefore - state.requests.length,
        removedEdges: edgeCountBefore - state.edges.length,
      };
    });
  }

  async unblock({ guildId, userId, targetId }) {
    return this.store.transact((state) => {
      purgeExpiredRequests(state, this.now());

      const profile = ensureProfile(state, guildId, userId);
      const wasBlocked =
        profile.blockedUserIds.includes(targetId);

      profile.blockedUserIds = profile.blockedUserIds.filter(
        (blockedUserId) => blockedUserId !== targetId,
      );

      return wasBlocked;
    });
  }

  async getTree({ guildId, viewerId, memberId }) {
    return this.store.transact((state) => {
      purgeExpiredRequests(state, this.now());

      if (
        !canViewMember(state, guildId, viewerId, memberId)
      ) {
        throw new BondError(
          'That member’s bond tree is private.',
          'PRIVATE_TREE',
        );
      }

      const relationships = state.edges
        .filter(
          (edge) =>
            edge.guildId === guildId &&
            (edge.fromId === memberId ||
              edge.toId === memberId),
        )
        .map((edge) => {
          const otherUserId =
            edge.fromId === memberId
              ? edge.toId
              : edge.fromId;

          return {
            edge,
            otherUserId,
            label: relationshipLabel(edge, memberId),
          };
        })
        .filter(
          ({ otherUserId }) =>
            canViewMember(
              state,
              guildId,
              viewerId,
              otherUserId,
            ),
        )
        .sort(
          (left, right) =>
            left.label.localeCompare(right.label) ||
            left.otherUserId.localeCompare(right.otherUserId),
        );

      return {
        visibility: getProfile(state, guildId, memberId)
          .visibility,
        relationships,
      };
    });
  }

  async exportUserData({ guildId, userId }) {
    return this.store.transact((state) => {
      const now = this.now();
      purgeExpiredRequests(state, now);

      return {
        exportedAt: new Date(now).toISOString(),
        guildId,
        userId,
        profile: getProfile(state, guildId, userId),
        requests: state.requests.filter(
          (request) =>
            request.guildId === guildId &&
            (request.requesterId === userId ||
              request.targetId === userId),
        ),
        edges: state.edges.filter(
          (edge) =>
            edge.guildId === guildId &&
            (edge.fromId === userId ||
              edge.toId === userId),
        ),
      };
    });
  }

  async eraseUserData({ guildId, userId }) {
    return this.store.transact((state) => {
      purgeExpiredRequests(state, this.now());

      const key = memberKey(guildId, userId);
      const hadProfile = Boolean(state.members[key]);
      const requestCountBefore = state.requests.length;
      const edgeCountBefore = state.edges.length;

      delete state.members[key];
      state.requests = state.requests.filter(
        (request) =>
          !(
            request.guildId === guildId &&
            (request.requesterId === userId ||
              request.targetId === userId)
          ),
      );
      state.edges = state.edges.filter(
        (edge) =>
          !(
            edge.guildId === guildId &&
            (edge.fromId === userId ||
              edge.toId === userId)
          ),
      );

      for (const [profileKey, profile] of Object.entries(
        state.members,
      )) {
        if (!profileKey.startsWith(`${guildId}:`)) {
          continue;
        }

        profile.blockedUserIds =
          profile.blockedUserIds.filter(
            (blockedUserId) => blockedUserId !== userId,
          );
      }

      return {
        removedProfile: hadProfile,
        removedRequests:
          requestCountBefore - state.requests.length,
        removedEdges: edgeCountBefore - state.edges.length,
      };
    });
  }
}

module.exports = {
  BOND_TYPE_CHOICES,
  BondError,
  BondService,
  PRIVACY_CHOICES,
  REQUEST_RETENTION_MS,
  canViewMember,
  getProfile,
  isBetween,
  relationshipLabel,
};
