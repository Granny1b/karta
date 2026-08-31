import type { BoardDoc, BoardNode, Edge, Id, MediaRef } from '@/domain/board';
import { nowIso } from '@/lib/format';
import type { BoardState } from '@/state/boardStore';
import { makeBoardLink } from '@/state/factories';
import { boundsOfNodes, centreOfBounds, type Bounds } from '@/canvas/ops';

/** Margin between the child board's origin and the extracted content. */
const CHILD_MARGIN = 80;

export interface ExtractApi {
  createBoard(input: { title: string; parentBoardId?: Id | null }): Promise<{ doc: BoardDoc; etag: string }>;
  putBoard(
    id: Id,
    doc: BoardDoc,
    ifMatch: string | null,
    orphanBlobPaths?: string[],
  ): Promise<{ etag: string; doc: BoardDoc }>;
  snapshot(id: Id): Promise<{ snapshotName: string }>;
}

export interface ExtractDeps {
  getState(): BoardState;
  api: ExtractApi;
  /** Non-fatal problems — a missing snapshot, say — surface here. */
  onWarning?(message: string): void;
}

export interface ExtractPlan {
  moved: BoardNode[];
  movedIds: Set<Id>;
  internalEdges: Edge[];
  crossingEdges: Edge[];
  bounds: Bounds;
}

export interface ExtractResult {
  boardId: Id;
  title: string;
  nodeCount: number;
}

/** Media a set of nodes needs: covers, image sources and anything named in prose. */
export function usedMediaIds(nodes: readonly BoardNode[], media: readonly MediaRef[]): Set<Id> {
  const used = new Set<Id>();
  const prose: string[] = [];

  for (const node of nodes) {
    if (node.kind === 'image') used.add(node.mediaId);
    if (node.kind === 'card') {
      if (node.coverMediaId) used.add(node.coverMediaId);
      prose.push(node.body);
    }
    if (node.kind === 'note') prose.push(node.text);
  }

  if (prose.length > 0) {
    const text = prose.join('\n');
    for (const ref of media) if (text.includes(ref.id)) used.add(ref.id);
  }

  return used;
}

/** Splits the board around a selection: what moves, what follows, what reattaches. */
export function planExtract(doc: BoardDoc, nodeIds: readonly Id[]): ExtractPlan | null {
  const wanted = new Set(nodeIds);
  const moved = doc.nodes.filter((node) => wanted.has(node.id));
  const bounds = boundsOfNodes(moved);
  if (!bounds) return null;

  const movedIds = new Set(moved.map((node) => node.id));
  const internalEdges: Edge[] = [];
  const crossingEdges: Edge[] = [];

  for (const edge of doc.edges) {
    const from = movedIds.has(edge.source);
    const to = movedIds.has(edge.target);
    if (from && to) internalEdges.push(edge);
    else if (from || to) crossingEdges.push(edge);
  }

  return { moved, movedIds, internalEdges, crossingEdges, bounds };
}

/** A name that means something without asking: the frame, the card, or the parent. */
export function defaultExtractTitle(doc: BoardDoc, moved: readonly BoardNode[]): string {
  const group = moved.find((node) => node.kind === 'group');
  if (group && group.kind === 'group' && group.title.trim().length > 0) return group.title.trim();

  const cards = moved.filter((node) => node.kind === 'card');
  if (cards.length === 1 && cards[0].kind === 'card' && cards[0].title.trim().length > 0) {
    return cards[0].title.trim();
  }

  return `Extracted from ${doc.title}`;
}

/**
 * Moves a selection into a fresh child board and leaves a `boardLink` at the
 * centroid of the old bounding box (spec 7.3). A snapshot of the parent is
 * taken first (spec 7.5) and the child is written before the parent loses
 * anything, so a failure anywhere leaves the work where it was.
 */
export async function extractToBoard(
  deps: ExtractDeps,
  nodeIds: readonly Id[],
  title?: string,
): Promise<ExtractResult> {
  const state = deps.getState();
  const doc = state.doc;
  const parentId = state.boardId;
  if (!doc || !parentId) throw new Error('No board is open');
  if (nodeIds.length === 0) throw new Error('Select the nodes to extract first');

  const plan = planExtract(doc, nodeIds);
  if (!plan) throw new Error('Nothing in that selection could be extracted');

  // The snapshot has to include the work on screen, so flush it first.
  if (state.dirty) await deps.getState().save();
  try {
    await deps.api.snapshot(parentId);
  } catch {
    deps.onWarning?.('Could not take a snapshot before extracting — continuing anyway.');
  }

  const boardTitle = (title ?? defaultExtractTitle(doc, plan.moved)).slice(0, 120);
  const created = await deps.api.createBoard({ title: boardTitle, parentBoardId: parentId });

  // Re-read: saving, snapshotting and creating the child all went to the
  // network, and the board may have been edited while they were in flight.
  const live = deps.getState();
  const current = live.doc;
  if (!current || live.boardId !== parentId) throw new Error('The board changed while extracting');
  const finalPlan = planExtract(current, nodeIds);
  if (!finalPlan) throw new Error('Those nodes are no longer on this board');

  const stamp = nowIso();
  const childMediaIds = usedMediaIds(finalPlan.moved, current.media);
  const childDoc: BoardDoc = {
    ...created.doc,
    title: boardTitle,
    parentBoardId: parentId,
    updatedAt: stamp,
    viewport: { x: 0, y: 0, zoom: 1 },
    // Statuses and labels come along by id, so moved cards keep their meaning.
    statuses: current.statuses.map((status) => ({ ...status })),
    labels: current.labels.map((label) => ({ ...label })),
    nodes: finalPlan.moved.map((node) => ({
      ...node,
      position: {
        x: Math.round(node.position.x - finalPlan.bounds.x + CHILD_MARGIN),
        y: Math.round(node.position.y - finalPlan.bounds.y + CHILD_MARGIN),
      },
      updatedAt: stamp,
    })),
    edges: finalPlan.internalEdges.map((edge) => ({ ...edge })),
    media: current.media.filter((ref) => childMediaIds.has(ref.id)).map((ref) => ({ ...ref })),
  };

  await deps.api.putBoard(created.doc.id, childDoc, created.etag, []);

  const centre = centreOfBounds(finalPlan.bounds);
  const link = makeBoardLink({
    targetBoardId: created.doc.id,
    cachedTitle: boardTitle,
    cachedCounts: {
      total: finalPlan.moved.filter((node) => node.kind === 'card').length,
      done: 0,
    },
    userId: live.me?.userId ?? '',
  });
  link.position = {
    x: Math.round(centre.x - link.size.w / 2),
    y: Math.round(centre.y - link.size.h / 2),
  };

  const movedIds = finalPlan.movedIds;
  const internalIds = new Set(finalPlan.internalEdges.map((edge) => edge.id));

  deps.getState().mutate('Extract to board', (d) => {
    d.nodes = d.nodes.filter((node) => !movedIds.has(node.id));
    d.nodes.push(link);

    const kept: Edge[] = [];
    const seen = new Set<string>();
    for (const edge of d.edges) {
      if (internalIds.has(edge.id)) continue;
      const next: Edge = { ...edge };
      if (movedIds.has(next.source)) next.source = link.id;
      if (movedIds.has(next.target)) next.target = link.id;
      if (next.source === next.target) continue;
      const key = `${next.source}|${next.sourceHandle}|${next.target}|${next.targetHandle}|${next.semantic}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.updatedAt = stamp;
      kept.push(next);
    }
    d.edges = kept;

    // The child board now owns these blobs, so they are moved, not orphaned:
    // nothing goes on `pendingOrphans` and nothing is deleted from storage.
    const stillUsed = usedMediaIds(d.nodes, d.media);
    d.media = d.media.filter((ref) => stillUsed.has(ref.id) || !childMediaIds.has(ref.id));
  });

  await deps.getState().save();

  return { boardId: created.doc.id, title: boardTitle, nodeCount: finalPlan.moved.length };
}
