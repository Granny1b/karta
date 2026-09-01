import type { Id } from '@/domain/board';
import { api } from '@/lib/api';
import { makeBoardLink } from '@/state/factories';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';

/**
 * Put an empty nested board on the canvas.
 *
 * Every other way in needed cards to already exist: *Extract to a nested board*
 * moves a selection into a new child, and the sidebar makes one from the tree.
 * Neither answers "give me an empty sub-board here and let me fill it", which
 * is how a map actually gets drawn — the doorway first, the rooms after.
 *
 * `connect.ts` assumed the opposite ("a nested board cannot be conjured
 * empty"), and it is only true of the synchronous path: a child board has to
 * exist on the server before a link can point at it, so this is async and lives
 * apart from `nodeForChoice`.
 *
 * The child is created first and the link added second. If the link write fails
 * the board still exists and is in the sidebar, which is recoverable; a link
 * pointing at a board that was never created is not.
 */
/**
 * The link node that should open its name field the moment it appears.
 *
 * Read once and cleared, so a tile only ever does this for the creation that
 * asked for it — a re-render, or the node arriving again after a reload, must
 * not reopen a field the user has already closed.
 */
let renameOnMount: Id | null = null;

export function takeRenameOnMount(nodeId: Id): boolean {
  if (renameOnMount !== nodeId) return false;
  renameOnMount = null;
  return true;
}

export async function createSubBoardAt(
  position: { x: number; y: number },
  title = 'New board',
): Promise<Id | null> {
  const store = useBoardStore.getState();
  const ui = useUiStore.getState();
  const parentBoardId = store.boardId;

  if (parentBoardId === null || store.doc === null) {
    ui.toast('Open a board first', 'warn');
    return null;
  }

  try {
    const created = await api.createBoard({ title, parentBoardId });

    const link = makeBoardLink({
      targetBoardId: created.doc.id,
      cachedTitle: created.doc.title,
      // Honest for a board with nothing in it; refreshed from the index on open.
      cachedCounts: { total: 0, done: 0 },
      userId: store.me?.userId ?? '',
      position: { x: Math.round(position.x), y: Math.round(position.y) },
    });

    store.addNode(link);

    // Two things have to be true before the user can walk into this board.
    //
    // The link must be on the server, because opening the child replaces the
    // parent document in memory and an unsaved link would go with it — the same
    // reason the sidebar saves before it navigates.
    await store.save();

    // And the index must know the board exists. The breadcrumb is built by
    // walking parentBoardId through the index (`Breadcrumb.chainFor`), and a
    // board it cannot find breaks the walk on its first step — leaving no
    // breadcrumb at all, not merely a shorter one. `api.createBoard` updates
    // the index on the server; this is what makes the client's copy agree.
    await store.loadIndex();

    // A board arrives called "New board", so the one thing the user certainly
    // wants next is to name it. The tile picks this up as it mounts and opens
    // its field, which turns creating and naming into one gesture instead of a
    // creation followed by a hunt for where the rename lives.
    renameOnMount = link.id;

    ui.toast('Nested board added — double-click it to go in');
    return created.doc.id;
  } catch {
    // The API client already turns a refusal into a readable message; what is
    // worth saying here is which action failed, not how.
    ui.toast('Could not create the nested board', 'error');
    return null;
  }
}
