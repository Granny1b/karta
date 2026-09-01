import type { BoardIndex, BoardNode, BoardSummary, Id } from '@/domain/board';

/**
 * What deleting a selection would take with it.
 *
 * A board link is a doorway, and until now deleting one left the room standing:
 * the board stayed in the sidebar looking like a delete that had failed. It
 * should go too — but a board can hold a great deal of work behind a tile the
 * size of a card, so a board with anything in it is worth asking about first.
 *
 * Pure, so the question "is this destructive, and how much" is decided and
 * tested away from the dialog that asks it.
 */

export interface DoomedBoard {
  readonly linkNodeId: Id;
  readonly boardId: Id;
  readonly title: string;
  readonly cards: number;
  /** Child boards that would be orphaned — they are not deleted with it. */
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
 * The boards behind the links in `nodeIds`.
 *
 * A link whose board the index does not know about is reported with
 * `known: false` rather than dropped: the node still goes, and the caller can
 * say so instead of silently doing half the job.
 */
export function planBoardDeletion(
  nodeIds: readonly Id[],
  nodes: readonly BoardNode[],
  index: BoardIndex | null,
): DeletionPlan {
  if (nodeIds.length === 0) return EMPTY;

  const doomed = new Set(nodeIds);
  const byId = new Map<Id, BoardSummary>(
    (index?.boards ?? []).filter((b) => b.deletedAt === null).map((b) => [b.id, b]),
  );

  const boards: DoomedBoard[] = [];
  const seen = new Set<Id>();

  for (const node of nodes) {
    if (!doomed.has(node.id) || node.kind !== 'boardLink') continue;
    // Two links to one board delete it once.
    if (seen.has(node.targetBoardId)) continue;
    seen.add(node.targetBoardId);

    const summary = byId.get(node.targetBoardId);
    boards.push({
      linkNodeId: node.id,
      boardId: node.targetBoardId,
      title: summary?.title ?? node.cachedTitle,
      cards: summary?.counts.cards ?? 0,
      children: summary?.counts.children ?? 0,
      known: summary !== undefined,
    });
  }

  return {
    boards,
    withContent: boards.filter((b) => b.known && (b.cards > 0 || b.children > 0)),
  };
}

/** What the confirmation says a board holds, in words. */
export function describeContents(board: DoomedBoard): string {
  const parts: string[] = [];
  if (board.cards > 0) parts.push(`${board.cards} card${board.cards === 1 ? '' : 's'}`);
  if (board.children > 0) {
    parts.push(`${board.children} nested board${board.children === 1 ? '' : 's'}`);
  }
  return parts.length === 0 ? 'empty' : parts.join(' and ');
}
