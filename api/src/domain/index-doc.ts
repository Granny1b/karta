/**
 * `boards/_index.json` — one small document holding a summary of every board.
 *
 * It exists so the sidebar tree and the `boardLink` rollups cost one blob read
 * instead of N. It is derived data: if it were ever lost it could be rebuilt by
 * listing the container, so every function here is pure and total, and the
 * index is rewritten from the board document on each write rather than patched
 * from a diff.
 */

import type { BoardDoc, BoardIndex, BoardSummary, Id } from '../../../src/domain/board.js';
import { SCHEMA_VERSION, isCardNode } from '../../../src/domain/board.js';

export function emptyIndex(): BoardIndex {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), boards: [] };
}

/**
 * Derive a board's index entry. `counts.children` is left at zero here — only
 * the whole index knows how many children a board has, so it is filled in by
 * {@link recomputeChildCounts}, which every mutation below runs.
 */
export function buildSummary(doc: BoardDoc): BoardSummary {
  const doneStatusIds = new Set(doc.statuses.filter((s) => s.isDone).map((s) => s.id));

  let cards = 0;
  let done = 0;
  for (const node of doc.nodes) {
    if (!isCardNode(node)) continue;
    cards++;
    if (node.statusId !== null && doneStatusIds.has(node.statusId)) done++;
  }

  return {
    id: doc.id,
    parentBoardId: doc.parentBoardId,
    title: doc.title,
    icon: doc.icon,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt,
    counts: { cards, done, children: 0 },
    ownerId: doc.acl.ownerId,
  };
}

/** Insert or replace one entry, keeping the list ordered by id (creation order). */
export function upsertSummary(index: BoardIndex, summary: BoardSummary): BoardIndex {
  const boards = index.boards.filter((b) => b.id !== summary.id);
  boards.push(summary);
  boards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return recomputeChildCounts({ ...index, boards });
}

export function removeSummary(index: BoardIndex, id: Id): BoardIndex {
  const boards = index.boards.filter((b) => b.id !== id);
  if (boards.length === index.boards.length) {
    return recomputeChildCounts(index);
  }
  return recomputeChildCounts({ ...index, boards });
}

/**
 * Recount every board's live children. Soft-deleted boards do not count
 * towards their parent's rollup — a deleted child is gone as far as the parent
 * dashboard is concerned — but they stay in the index so they can be restored.
 */
export function recomputeChildCounts(index: BoardIndex): BoardIndex {
  const childCount = new Map<Id, number>();
  for (const board of index.boards) {
    if (board.deletedAt !== null || board.parentBoardId === null) continue;
    childCount.set(board.parentBoardId, (childCount.get(board.parentBoardId) ?? 0) + 1);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    boards: index.boards.map((board) => {
      const children = childCount.get(board.id) ?? 0;
      if (board.counts.children === children) return board;
      return { ...board, counts: { ...board.counts, children } };
    }),
  };
}
