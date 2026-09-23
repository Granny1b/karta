import type { BoardIndex, BoardNode, BoardSummary, Id } from '@/domain/board';
import { subtreeTotals } from '@/board/boardSubtree';

/**
 * What deleting a selection would take with it.
 *
 * A board link is a doorway, and until now deleting one left the room standing:
 * the board stayed in the sidebar looking like a delete that had failed. It
 * should go too, along with whatever is nested inside it — but a board can hold
 * a great deal of work behind a tile the size of a card, so a board with
 * anything in it is worth asking about first.
 *
 * Pure, so the question "is this destructive, and how much" is decided and
 * tested away from the dialog that asks it.
 */

export interface DoomedBoard {
  readonly linkNodeId: Id;
  readonly boardId: Id;
  readonly title: string;
  /** Cards on the board and on every board nested inside it. */
  readonly cards: number;
  /** Boards nested inside it, at every level. They are deleted with it. */
  readonly children: number;
  /** In the index and reachable, so it can actually be deleted. */
  readonly known: boolean;
}

export interface DeletionPlan {
  readonly boards: readonly DoomedBoard[];
  /** Boards holding cards or children: the reason to stop and ask. */
  readonly withContent: readonly DoomedBoard[];
}

const EMPTY: DeletionPlan = { boards: [], withContent: [] };

/**
 * The boards behind the links in `nodeIds`, which sit on `hostBoardId`.
 *
 * Only a board's *doorway* takes the board with it: the tile on the board's own
 * parent, with no other tile to the same board left beside it — "the only thing
 * on the canvas standing for that board". Duplicate and paste copy a tile as it
 * is, target and all, so a board can have several; deleting a copy used to
 * delete the board behind all of them, and then sweep the original tile away
 * too. Any other tile is a shortcut, and deleting it deletes the tile alone.
 * Nor does a tile ever take the board it stands on, or one above it: a pasted
 * link back up the tree would otherwise delete the floor under the user.
 *
 * A link whose board the index does not know about is reported with
 * `known: false` rather than dropped: the node still goes, and the caller can
 * say so instead of silently doing half the job.
 */
export function planBoardDeletion(
  nodeIds: readonly Id[],
  nodes: readonly BoardNode[],
  index: BoardIndex | null,
  hostBoardId: Id,
): DeletionPlan {
  if (nodeIds.length === 0) return EMPTY;

  const doomed = new Set(nodeIds);
  const all = index?.boards ?? [];
  const byId = new Map<Id, BoardSummary>(all.filter((b) => b.deletedAt === null).map((b) => [b.id, b]));

  // Boards still reached by a tile that is staying.
  const kept = new Set<Id>();
  for (const node of nodes) {
    if (node.kind === 'boardLink' && !doomed.has(node.id)) kept.add(node.targetBoardId);
  }

  // The host and everything above it, deleted boards included: the walk is
  // about where the user stands, not about what the tree still shows.
  const underfoot = new Set<Id>([hostBoardId]);
  const parentOf = new Map<Id, Id | null>(all.map((b) => [b.id, b.parentBoardId]));
  let cursor = parentOf.get(hostBoardId) ?? null;
  while (cursor !== null && !underfoot.has(cursor)) {
    underfoot.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }

  const boards: DoomedBoard[] = [];
  const seen = new Set<Id>();

  for (const node of nodes) {
    if (!doomed.has(node.id) || node.kind !== 'boardLink') continue;
    // Two links to one board delete it once.
    if (seen.has(node.targetBoardId)) continue;
    seen.add(node.targetBoardId);

    if (kept.has(node.targetBoardId) || underfoot.has(node.targetBoardId)) continue;
    const summary = byId.get(node.targetBoardId);
    // A board nested somewhere else has its doorway there; this is a shortcut.
    if (summary !== undefined && summary.parentBoardId !== hostBoardId) continue;

    // Everything under the tile, not just the board the tile names: deleting a
    // board deletes what is nested inside it, so that is what has to be counted
    // in the question asked first.
    const totals = summary ? subtreeTotals(index, summary.id) : { boards: 0, cards: 0 };
    boards.push({
      linkNodeId: node.id,
      boardId: node.targetBoardId,
      title: summary?.title ?? node.cachedTitle,
      cards: totals.cards,
      children: totals.boards,
      known: summary !== undefined,
    });
  }

  return {
    boards,
    withContent: boards.filter((b) => b.known && (b.cards > 0 || b.children > 0)),
  };
}
