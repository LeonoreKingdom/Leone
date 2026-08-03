const {
  BondError,
  canViewMember,
  relationshipLabel,
} = require('./bond-service');

const MAX_DEPTH = 4;
const MAX_NODES = 50;

class FamilyTreeService {
  constructor({ store }) {
    this.store = store;
  }

  async getGraph({
    guildId,
    viewerId,
    memberId,
    depth = 2,
    types = null,
  }) {
    const safeDepth = Math.min(Math.max(Number(depth) || 2, 1), MAX_DEPTH);
    const typeFilter = types?.length ? new Set(types) : null;

    return this.store.read((state) => {
      if (!canViewMember(state, guildId, viewerId, memberId)) {
        throw new BondError(
          'That member’s family tree is private.',
          'PRIVATE_TREE',
        );
      }

      const guildEdges = state.edges.filter(
        (edge) =>
          edge.guildId === guildId &&
          (!typeFilter || typeFilter.has(edge.type)),
      );
      const visibleNodes = new Set([memberId]);
      const visibleEdges = new Map();
      const queue = [{ userId: memberId, level: 0 }];
      const expanded = new Set();

      while (queue.length > 0 && visibleNodes.size < MAX_NODES) {
        const current = queue.shift();

        if (current.level >= safeDepth || expanded.has(current.userId)) {
          continue;
        }

        expanded.add(current.userId);

        for (const edge of guildEdges) {
          if (
            edge.fromId !== current.userId &&
            edge.toId !== current.userId
          ) {
            continue;
          }

          if (
            !canViewMember(state, guildId, viewerId, edge.fromId) ||
            !canViewMember(state, guildId, viewerId, edge.toId)
          ) {
            continue;
          }

          const otherUserId =
            edge.fromId === current.userId ? edge.toId : edge.fromId;

          if (!visibleNodes.has(otherUserId)) {
            if (visibleNodes.size >= MAX_NODES) {
              break;
            }
            visibleNodes.add(otherUserId);
            queue.push({ userId: otherUserId, level: current.level + 1 });
          }

          visibleEdges.set(edge.id, {
            id: edge.id,
            type: edge.type,
            source: edge.fromId,
            target: edge.toId,
            sourceLabel: relationshipLabel(edge, edge.fromId),
            targetLabel: relationshipLabel(edge, edge.toId),
          });
        }
      }

      return {
        rootUserId: memberId,
        depth: safeDepth,
        truncated: visibleNodes.size >= MAX_NODES,
        nodeIds: [...visibleNodes],
        edges: [...visibleEdges.values()].filter(
          (edge) =>
            visibleNodes.has(edge.source) &&
            visibleNodes.has(edge.target),
        ),
      };
    });
  }
}

module.exports = {
  FamilyTreeService,
  MAX_DEPTH,
  MAX_NODES,
};
