import type { Id } from '@/domain/board';
import { api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';
import { boardSubtree } from '@/board/boardSubtree';

/**
 * Deleting a board, and everything that hangs off it.
 *
 * Deleting one board used to mean exactly that: the board was stamped
 * `deletedAt` and nothing else moved. Two things were left behind, and both of
 * them were visible the moment a board with anything under it was deleted:
 *
 * - **Its nested boards were cut loose.** They were still live, their parent
 *   was not, so the tree lifted them to the top level — a delete of one board
 *   answered with a handful of boards appearing beside the root, in no order
 *   anyone asked for.
 * - **Its doorway stayed on the canvas.** The `boardLink` tile on the parent
 *   board still opened the deleted board, which read as the delete having
 *   failed. It had not: soft-deleted boards still resolve over the API, because
 *   restoring one would be impossible otherwise.
 *
 * So a board goes with what is nested inside it, and the tile that opened it
 * goes too. Blob soft delete (14 days, spec 4.1) is still the floor under all
 * of it, and each board keeps its own `deletedAt`, so a restore is still
 * per-board.
 */

export interface BoardDeletion {
  /** Boards the server accepted the delete for — the roots and their nested boards. */
  readonly deleted: readonly Id[];
  /** How many deletes were refused. The boards behind them are still there. */
  readonly failed: number;
  /** Parent boards whose doorway tile could not be removed; their link is now dead. */
  readonly doorwaysLeft: number;
}

/**
 * Soft-delete `rootIds` and everything nested under them, then take the
 * doorways down.
 *
 * Deletes are settled together rather than in sequence: one board refusing must
 * not decide the fate of the rest, and the caller is told the count so it can
 * say what actually happened. The index is reloaded before returning, so the
 * tree and the rollups are current by the time anyone looks.
 */
export async function deleteBoardsAndDescendants(rootIds: readonly Id[]): Promise<BoardDeletion> {
  const store = useBoardStore.getState();
  const subtree = boardSubtree(store.index, rootIds);

  // A board the index has not caught up with is still deletable: it is named
  // here and the API decides. Duplicates would delete the same board twice.
  const targets = [...new Set<Id>([...rootIds, ...subtree.map((b) => b.id)])];
  if (targets.length === 0) return { deleted: [], failed: 0, doorwaysLeft: 0 };

  const results = await Promise.allSettled(targets.map((id) => api.deleteBoard(id)));
  const deleted = targets.filter((_, i) => results[i]?.status === 'fulfilled');
  const gone = new Set(deleted);

  // Where a doorway to any of them can be: on the parent board, which is where
  // creating a child board puts one, and on the board being looked at, which
  // may hold a link to anything. A board that is itself gone — one inside the
  // subtree, or one deleted earlier — is not worth writing to.
  const buried = new Set(
    (store.index?.boards ?? []).filter((b) => b.deletedAt !== null).map((b) => b.id),
  );
  const reachable = (id: Id): boolean => !gone.has(id) && !buried.has(id);

  const doorways = new Set<Id>();
  for (const board of subtree) {
    const parentId = board.parentBoardId;
    if (parentId !== null && reachable(parentId)) doorways.add(parentId);
  }
  const openId = useBoardStore.getState().boardId;
  if (openId !== null && reachable(openId)) doorways.add(openId);

  let doorwaysLeft = 0;
  for (const boardId of doorways) {
    try {
      await removeLinksTo(boardId, gone);
    } catch {
      // The board is deleted either way; only its tile is still standing, and
      // a tile to a deleted board draws itself as one.
      doorwaysLeft += 1;
    }
  }

  await useBoardStore.getState().loadIndex();
  return { deleted, failed: targets.length - deleted.length, doorwaysLeft };
}

/**
 * Take every `boardLink` on `boardId` that points into `gone` off the board.
 *
 * The open board goes through the store, so the removal is one ordinary edit
 * that the autosave flushes — and it takes any arrows attached to the tile with
 * it. Any other board is the guarded round trip a rename of a closed board
 * already takes: read, write back under the ETag it was read at. A refusal
 * stays a refusal; we do not re-read and force over whoever got there first.
 */
async function removeLinksTo(boardId: Id, gone: ReadonlySet<Id>): Promise<void> {
  const store = useBoardStore.getState();

  if (store.boardId === boardId && store.doc) {
    const ids = store.doc.nodes
      .filter((node) => node.kind === 'boardLink' && gone.has(node.targetBoardId))
      .map((node) => node.id);
    if (ids.length === 0) return;
    store.removeNodes(ids);
    await store.save();
    return;
  }

  const { doc, etag } = await api.getBoard(boardId);
  const doomed = new Set(
    doc.nodes
      .filter((node) => node.kind === 'boardLink' && gone.has(node.targetBoardId))
      .map((node) => node.id),
  );
  if (doomed.size === 0) return;

  await api.putBoard(
    boardId,
    {
      ...doc,
      nodes: doc.nodes.filter((node) => !doomed.has(node.id)),
      edges: doc.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
    },
    etag,
    [],
  );
}
