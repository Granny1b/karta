import type { BoardDoc, BoardNode, Edge, Id, LabelDef, MediaRef, StatusDef } from '@/domain/board';

/**
 * Three-way merge at node granularity (spec 6.4, step 3).
 *
 * `base` is the document as it was when this client loaded it, `local` is what
 * the user has now, `server` is what the failed `If-Match` says is stored. The
 * rules are deliberately coarse — whole-node last-writer-wins — so the outcome
 * is always explainable:
 *
 * - node only local → keep it (added here, or edited after a remote delete)
 * - node only on server → take it (added there, or edited after a local delete)
 * - node on both sides → the later `updatedAt` wins, whole node
 * - deleted on one side, edited on the other → the edit survives, with a note
 * - edges follow the same rule, then any edge with a missing endpoint is dropped
 * - statuses, labels and media are unioned by id
 *
 * Pure: neither input is mutated and no object from either input is written to.
 */

export interface MergeResult {
  doc: BoardDoc;
  notes: string[];
}

function indexById<T extends { id: Id }>(items: readonly T[]): Map<Id, T> {
  const map = new Map<Id, T>();
  for (const item of items) map.set(item.id, item);
  return map;
}

/** ISO 8601 UTC strings compare correctly as plain strings. */
function isLater(a: string, b: string): boolean {
  return a > b;
}

function nodeLabel(node: BoardNode): string {
  switch (node.kind) {
    case 'card':
    case 'group':
      return node.title.trim() || 'Untitled';
    case 'note': {
      const firstLine = node.text.split('\n', 1)[0]?.trim() ?? '';
      return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine || 'Note';
    }
    case 'image':
      return node.caption?.trim() || 'Image';
    case 'boardLink':
      return node.cachedTitle.trim() || 'Board link';
  }
}

function kindWord(node: BoardNode): string {
  switch (node.kind) {
    case 'card':
      return 'Card';
    case 'note':
      return 'Note';
    case 'image':
      return 'Image';
    case 'boardLink':
      return 'Board link';
    case 'group':
      return 'Group';
  }
}

/** Union by id; on conflict the side whose document was written later wins. */
function unionById<T extends { id: Id }>(local: readonly T[], server: readonly T[], localWins: boolean): T[] {
  const serverById = indexById(server);
  const out: T[] = [];
  const seen = new Set<Id>();

  for (const item of local) {
    const other = serverById.get(item.id);
    out.push(other && !localWins ? other : item);
    seen.add(item.id);
  }
  for (const item of server) {
    if (!seen.has(item.id)) out.push(item);
  }
  return out;
}

function mergeNodes(
  base: Map<Id, BoardNode>,
  local: readonly BoardNode[],
  server: readonly BoardNode[],
  notes: string[],
): BoardNode[] {
  const localById = indexById(local);
  const serverById = indexById(server);
  const out: BoardNode[] = [];

  for (const node of local) {
    const remote = serverById.get(node.id);
    if (remote) {
      out.push(isLater(remote.updatedAt, node.updatedAt) ? remote : node);
      continue;
    }
    const original = base.get(node.id);
    if (!original) {
      out.push(node); // created here
      continue;
    }
    if (isLater(node.updatedAt, original.updatedAt)) {
      out.push(node); // deleted elsewhere, but edited here — the edit wins
      notes.push(`${kindWord(node)} "${nodeLabel(node)}" was deleted elsewhere. Your edit was kept.`);
    }
    // otherwise: deleted on the server and untouched here — accept the delete
  }

  for (const node of server) {
    if (localById.has(node.id)) continue;
    const original = base.get(node.id);
    if (!original) {
      out.push(node); // created elsewhere
      continue;
    }
    if (isLater(node.updatedAt, original.updatedAt)) {
      out.push(node); // deleted here, but edited elsewhere — the edit wins
      notes.push(`${kindWord(node)} "${nodeLabel(node)}" was edited elsewhere, so it was not deleted.`);
    }
    // otherwise: deleted here and untouched there — the delete stands
  }

  return out;
}

function mergeEdges(
  base: Map<Id, Edge>,
  local: readonly Edge[],
  server: readonly Edge[],
  liveNodeIds: Set<Id>,
  notes: string[],
): Edge[] {
  const localById = indexById(local);
  const serverById = indexById(server);
  const merged: Edge[] = [];

  for (const edge of local) {
    const remote = serverById.get(edge.id);
    if (remote) {
      merged.push(isLater(remote.updatedAt, edge.updatedAt) ? remote : edge);
      continue;
    }
    const original = base.get(edge.id);
    if (!original || isLater(edge.updatedAt, original.updatedAt)) merged.push(edge);
  }

  for (const edge of server) {
    if (localById.has(edge.id)) continue;
    const original = base.get(edge.id);
    if (!original || isLater(edge.updatedAt, original.updatedAt)) merged.push(edge);
  }

  const kept = merged.filter((e) => liveNodeIds.has(e.source) && liveNodeIds.has(e.target));
  const dropped = merged.length - kept.length;
  if (dropped > 0) {
    notes.push(
      dropped === 1
        ? 'One arrow was dropped because a node it connected no longer exists.'
        : `${dropped} arrows were dropped because the nodes they connected no longer exist.`,
    );
  }
  return kept;
}

export function mergeBoards(base: BoardDoc, local: BoardDoc, server: BoardDoc): MergeResult {
  const notes: string[] = [];
  const localWins = !isLater(server.updatedAt, local.updatedAt);

  const nodes = mergeNodes(indexById(base.nodes), local.nodes, server.nodes, notes);
  const liveNodeIds = new Set<Id>(nodes.map((n) => n.id));
  const edges = mergeEdges(indexById(base.edges), local.edges, server.edges, liveNodeIds, notes);

  const statuses: StatusDef[] = unionById(local.statuses, server.statuses, localWins).sort(
    (a, b) => a.order - b.order,
  );
  const labels: LabelDef[] = unionById(local.labels, server.labels, localWins);
  const media: MediaRef[] = unionById(local.media, server.media, localWins);

  const head = localWins ? local : server;

  const doc: BoardDoc = {
    schemaVersion: local.schemaVersion,
    id: local.id,
    parentBoardId: head.parentBoardId,
    title: head.title,
    icon: head.icon,
    createdAt: base.createdAt || local.createdAt,
    updatedAt: isLater(server.updatedAt, local.updatedAt) ? server.updatedAt : local.updatedAt,
    deletedAt: head.deletedAt,
    acl: head.acl,
    viewport: local.viewport, // the camera is this client's business (spec 6.1)
    statuses,
    labels,
    nodes,
    edges,
    media,
  };

  if (head === server && server.title !== local.title) {
    notes.push(`The board was renamed elsewhere to "${server.title}".`);
  }

  return { doc, notes };
}
