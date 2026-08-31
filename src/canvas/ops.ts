import type { BoardDoc, BoardNode, Edge, GroupNode, Id } from '@/domain/board';
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
 * Copies of the given nodes, offset so the copy is visible, plus the edges that
 * ran between them. Ids, checklist item ids and card ranks are all freshly
 * minted; everything else is carried over.
 */
export function duplicateNodes(
  doc: BoardDoc,
  ids: readonly Id[],
  userId: string,
  offset: Point = { x: 24, y: 24 },
): Duplication {
  const wanted = new Set(ids);
  const sources = doc.nodes.filter((node) => wanted.has(node.id));
  const idMap = new Map<Id, Id>();
  const stamp = nowIso();

  // Ranks per column, so duplicated cards land after everything already there.
  const ranksByColumn = new Map<string, string[]>();
  for (const node of doc.nodes) {
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
      position: { x: source.position.x + offset.x, y: source.position.y + offset.y },
      size: { ...source.size },
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: userId,
    };

    if (copy.kind === 'card') {
      const key = copy.statusId ?? '';
      const ranks = ranksByColumn.get(key) ?? [];
      const rank = rankAfterAll(ranks);
      ranks.push(rank);
      ranksByColumn.set(key, ranks);
      copy.rank = rank;
      copy.checklist = copy.checklist.map((item) => ({ ...item, id: newId() }));
      copy.labelIds = [...copy.labelIds];
    }
    if (copy.kind === 'boardLink' && copy.cachedCounts) {
      copy.cachedCounts = { ...copy.cachedCounts };
    }
    if (copy.kind === 'image') {
      copy.naturalSize = { ...copy.naturalSize };
    }

    return copy;
  });

  const edges = doc.edges
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
