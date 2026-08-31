import type { BoardDoc, BoardNode, CardNode, Edge, GroupNode, Id } from '@/domain/board';
import type { ClipboardPayload } from '@/canvas/clipboard';
import { nowIso } from '@/lib/format';
import { newId } from '@/lib/ids';
import { rankAfterAll } from '@/lib/ranks';
import { makeGroup } from '@/state/factories';

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export function boundsOfNodes(nodes: readonly BoardNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.size.w);
    maxY = Math.max(maxY, node.position.y + node.size.h);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function centreOfBounds(bounds: Bounds): Point {
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

export function centreOfNode(node: BoardNode): Point {
  return { x: node.position.x + node.size.w / 2, y: node.position.y + node.size.h / 2 };
}

function contains(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.w &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.h
  );
}

/** Nodes whose centre sits inside the frame — the rule a group drag follows (spec 5.2). */
export function nodesInsideFrame(frame: GroupNode, nodes: readonly BoardNode[]): Id[] {
  const bounds: Bounds = { x: frame.position.x, y: frame.position.y, w: frame.size.w, h: frame.size.h };
  const inside: Id[] = [];
  for (const node of nodes) {
    if (node.id === frame.id || node.locked) continue;
    if (contains(bounds, centreOfNode(node))) inside.push(node.id);
  }
  return inside;
}

/** A frame that wraps the given nodes with `padding` breathing room. */
export function frameAround(nodes: readonly BoardNode[], userId: string, padding = 24): GroupNode | null {
  const bounds = boundsOfNodes(nodes);
  if (!bounds) return null;
  return makeGroup({
    userId,
    position: { x: bounds.x - padding, y: bounds.y - padding - 20 },
    size: { w: bounds.w + padding * 2, h: bounds.h + padding * 2 + 20 },
    padding,
  });
}

export interface Duplication {
  nodes: BoardNode[];
  edges: Edge[];
  idMap: Map<Id, Id>;
}

/**
 * Copies of `sources` placed into `target`, offset by `offset`, plus whichever
 * of `candidateEdges` ran between two of them. Ids, checklist item ids and card
 * ranks are all freshly minted; everything else is carried over, except the
 * references that only mean something on the board the copy came from — a
 * status, label or cover image `target` does not have is dropped rather than
 * written as a dangling id the server rejects (spec 6.3).
 */
function copyNodes(
  target: BoardDoc,
  sources: readonly BoardNode[],
  candidateEdges: readonly Edge[],
  userId: string,
  offset: Point,
): Duplication {
  const idMap = new Map<Id, Id>();
  const stamp = nowIso();

  const statusIds = new Set(target.statuses.map((status) => status.id));
  const labelIds = new Set(target.labels.map((label) => label.id));
  const mediaIds = new Set(target.media.map((media) => media.id));

  // Ranks per column, so copied cards land after everything already there.
  const ranksByColumn = new Map<string, string[]>();
  for (const node of target.nodes) {
    if (node.kind !== 'card') continue;
    const key = node.statusId ?? '';
    const list = ranksByColumn.get(key);
    if (list) list.push(node.rank);
    else ranksByColumn.set(key, [node.rank]);
  }

  const nodes = sources.map((source) => {
    const id = newId();
    idMap.set(source.id, id);

    const copy: BoardNode = {
      ...source,
      id,
      position: {
        x: Math.round(source.position.x + offset.x),
        y: Math.round(source.position.y + offset.y),
      },
      size: { ...source.size },
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: userId,
    };

    if (copy.kind === 'card') {
      if (copy.statusId !== null && !statusIds.has(copy.statusId)) copy.statusId = null;
      const key = copy.statusId ?? '';
      const ranks = ranksByColumn.get(key) ?? [];
      const rank = rankAfterAll(ranks);
      ranks.push(rank);
      ranksByColumn.set(key, ranks);
      copy.rank = rank;
      copy.checklist = copy.checklist.map((item) => ({ ...item, id: newId() }));
      copy.labelIds = copy.labelIds.filter((labelId) => labelIds.has(labelId));
      if (copy.coverMediaId !== null && !mediaIds.has(copy.coverMediaId)) copy.coverMediaId = null;
    }
    if (copy.kind === 'boardLink' && copy.cachedCounts) {
      copy.cachedCounts = { ...copy.cachedCounts };
    }
    if (copy.kind === 'image') {
      copy.naturalSize = { ...copy.naturalSize };
    }

    return copy;
  });

  const edges = candidateEdges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map<Edge>((edge) => ({
      ...edge,
      id: newId(),
      source: idMap.get(edge.source) as Id,
      target: idMap.get(edge.target) as Id,
      updatedAt: stamp,
    }));

  return { nodes, edges, idMap };
}

/**
 * Copies of the given nodes, offset so the copy is visible, plus the edges that
 * ran between them.
 */
export function duplicateNodes(
  doc: BoardDoc,
  ids: readonly Id[],
  userId: string,
  offset: Point = { x: 24, y: 24 },
): Duplication {
  const wanted = new Set(ids);
  const sources = doc.nodes.filter((node) => wanted.has(node.id));
  return copyNodes(doc, sources, doc.edges, userId, offset);
}

export interface Paste extends Duplication {
  /** Nodes this board cannot hold — an image whose file lives on another one. */
  skipped: number;
}

/**
 * A clipboard payload turned into nodes for `doc` (spec 9). An image is left
 * behind when its media is not on this board: the blob is stored under the
 * board it was uploaded to, so the copy would render an empty frame.
 */
export function pasteNodes(
  doc: BoardDoc,
  payload: ClipboardPayload,
  userId: string,
  offset: Point,
): Paste {
  const mediaIds = new Set(doc.media.map((media) => media.id));
  const usable = payload.nodes.filter((node) => node.kind !== 'image' || mediaIds.has(node.mediaId));
  const copy = copyNodes(doc, usable, payload.edges, userId, offset);
  return { ...copy, skipped: payload.nodes.length - usable.length };
}

/**
 * What a collapse toggle should write for a selection: one that is collapsed
 * all the way through opens, anything else collapses (spec 5.2).
 */
export function nextCollapsed(cards: readonly CardNode[]): boolean {
  return !cards.every((card) => card.collapsed);
}

/** The offset that lands the bounding box of `nodes` centred on `at`. */
export function offsetToCentre(nodes: readonly BoardNode[], at: Point, grid = 1): Point {
  const bounds = boundsOfNodes(nodes);
  if (!bounds) return { x: 0, y: 0 };
  const centre = centreOfBounds(bounds);
  const step = grid > 0 ? grid : 1;
  return {
    x: Math.round((at.x - centre.x) / step) * step,
    y: Math.round((at.y - centre.y) / step) * step,
  };
}
