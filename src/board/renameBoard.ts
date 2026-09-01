import { capText, MAX_TITLE, type Id } from '@/domain/board';
import { api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';

/**
 * Rename a board, whichever one it is.
 *
 * Two cases, and they cannot be one: the board that is open is a document the
 * store already holds, so it renames through `mutate` and undoes like any other
 * edit. Any other board has to be read and written back under the ETag it was
 * read at — a compare-and-swap rather than a blind overwrite, so a board changed
 * elsewhere in the meantime is refused rather than clobbered.
 *
 * Shared by the sidebar and by the board tile on the canvas. A guarded round
 * trip written twice is a guarantee held once.
 *
 * Returns whether the name actually changed, so a caller can stay quiet about a
 * rename that was really a no-op.
 */
export async function renameBoard(id: Id, title: string): Promise<boolean> {
  const trimmed = capText(title.trim(), MAX_TITLE);
  if (trimmed.length === 0) return false;

  const store = useBoardStore.getState();
  const known = store.index?.boards.find((b) => b.id === id);
  if (known && known.title === trimmed) return false;

  if (id === store.boardId) {
    store.mutate('Rename board', (d) => {
      d.title = trimmed;
    });
    await store.save();
    // The index carries the title the sidebar and the breadcrumb read, and the
    // link tiles on other boards are refreshed from it.
    await store.loadIndex();
    return true;
  }

  try {
    const { doc, etag } = await api.getBoard(id);
    await api.putBoard(id, { ...doc, title: trimmed }, etag, []);
    await store.loadIndex();
    return true;
  } catch {
    useUiStore.getState().toast('Could not rename the board', 'error');
    return false;
  }
}
