import type { BoardIndex, BoardSummary, Id } from '@/domain/board';
import { boardTree } from '@/state/selectors';

/**
 * Reading a board's subtree out of the index: what is nested under a board,
 * what that adds up to, and where to go when it is gone.
 *
 * Pure and store-free, so the question "what would deleting this take with it"
 * can be answered — and tested — away from the code that does the deleting.
 */

/**
 * The live boards under `rootIds` — the roots themselves first, then everything
 * nested below them, each listed once.
 *
 * Breadth-first and `seen`-guarded, so a `parentBoardId` chain that runs in a
 * circle cannot spin here; a root the index does not know about contributes
 * nothing rather than throwing.
 */
export function boardSubtree(index: BoardIndex | null, rootIds: readonly Id[]): BoardSummary[] {
  const live = (index?.boards ?? []).filter((b) => b.deletedAt === null);
  const byId = new Map<Id, BoardSummary>(live.map((b) => [b.id, b]));

  const childrenOf = new Map<Id, Id[]>();
  for (const board of live) {
    const parentId = board.parentBoardId;
    if (parentId === null || parentId === board.id) continue;
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(board.id);
    else childrenOf.set(parentId, [board.id]);
  }

  const found: BoardSummary[] = [];
  const seen = new Set<Id>();
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.shift() as Id;
    if (seen.has(id)) continue;
    seen.add(id);
    const summary = byId.get(id);
    if (summary) found.push(summary);
    for (const childId of childrenOf.get(id) ?? []) queue.push(childId);
  }
  return found;
}

/** What one board is holding, counting everything nested inside it. */
export function subtreeTotals(index: BoardIndex | null, rootId: Id): { boards: number; cards: number } {
  const found = boardSubtree(index, [rootId]);
  let cards = 0;
  for (const board of found) cards += board.counts.cards;
  // The root is in `found`; the count is of the boards that go with it.
  return { boards: Math.max(0, found.length - 1), cards };
}

/**
 * Which board to open when the one on screen has just been deleted: the nearest
 * ancestor still standing, or failing that the first row of the tree.
 *
 * `null` means stay where you are — including when the index has never heard of
 * the board, which is the ordinary state of a board created a moment ago and is
 * no reason to move anybody.
 */
export function boardToOpenAfterDelete(index: BoardIndex | null, openId: Id | null): Id | null {
  if (openId === null) return null;
  const byId = new Map<Id, BoardSummary>((index?.boards ?? []).map((b) => [b.id, b]));

  const open = byId.get(openId);
  if (!open || open.deletedAt === null) return null;

  const seen = new Set<Id>([openId]);
  let cursor = open.parentBoardId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const summary = byId.get(cursor);
    if (!summary) break;
    if (summary.deletedAt === null) return summary.id;
    cursor = summary.parentBoardId;
  }

  return boardTree(index)[0]?.summary.id ?? null;
}

/**
 * What a board holds, in words, for the question asked before deleting it:
 * "12 cards and 2 nested boards", or "empty".
 */
export function describeContents(board: { cards: number; children: number }): string {
  const parts: string[] = [];
  if (board.cards > 0) parts.push(`${board.cards} card${board.cards === 1 ? '' : 's'}`);
  if (board.children > 0) {
    parts.push(`${board.children} nested board${board.children === 1 ? '' : 's'}`);
  }
  return parts.length === 0 ? 'empty' : parts.join(' and ');
}
