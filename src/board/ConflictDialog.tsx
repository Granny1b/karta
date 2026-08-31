import { useState } from 'react';
import type { BoardDoc } from '@/domain/board';
import { api } from '@/lib/api';
import { nowIso } from '@/lib/format';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { clearWal } from '@/state/wal';
import { navigateToBoard } from '@/routes';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';

/**
 * The phase-1 conflict path (spec 6.4). The store already tries a node-level
 * merge three times; this is what is left when the merge itself keeps losing the
 * race, so it is blunt on purpose: take theirs, or keep yours somewhere safe.
 */
export default function ConflictDialog(): JSX.Element | null {
  const saveState = useBoardStore((s) => s.saveState);
  const boardId = useBoardStore((s) => s.boardId);
  const loadBoard = useBoardStore((s) => s.loadBoard);
  const loadIndex = useBoardStore((s) => s.loadIndex);
  const toast = useUiStore((s) => s.toast);

  const [busy, setBusy] = useState<'reload' | 'copy' | null>(null);

  if (saveState !== 'conflict' || !boardId) return null;

  const reload = async (): Promise<void> => {
    setBusy('reload');
    try {
      await clearWal(boardId);
      await loadBoard(boardId);
    } finally {
      setBusy(null);
    }
  };

  const saveCopy = async (): Promise<void> => {
    const doc: BoardDoc | null = useBoardStore.getState().doc;
    if (!doc) return;

    setBusy('copy');
    try {
      const created = await api.createBoard({
        title: `${doc.title} (copy)`,
        parentBoardId: doc.parentBoardId,
      });
      // Keep this board's content, take the new board's identity and ACL.
      const copy: BoardDoc = {
        ...doc,
        id: created.doc.id,
        parentBoardId: created.doc.parentBoardId,
        title: created.doc.title,
        createdAt: created.doc.createdAt,
        updatedAt: nowIso(),
        deletedAt: null,
        acl: created.doc.acl,
      };
      await api.putBoard(created.doc.id, copy, created.etag, []);
      await clearWal(boardId);
      await loadIndex();

      if (doc.media.length > 0) {
        toast('Images in the copy still point at the original board’s files.', 'warn');
      }
      toast('Your version was saved as a copy.');
      navigateToBoard(created.doc.id);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Could not save a copy', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      title="This board changed somewhere else"
      width="sm"
      dismissible={false}
      onClose={() => void reload()}
      footer={
        <>
          <Button disabled={busy !== null} onClick={() => void saveCopy()}>
            {busy === 'copy' ? 'Saving a copy…' : 'Save a copy'}
          </Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => void reload()}>
            {busy === 'reload' ? 'Reloading…' : 'Reload'}
          </Button>
        </>
      }
    >
      <p className="text-[14px] text-ink-muted">
        Another browser or another person saved this board after you opened it, and the two versions could not
        be merged automatically.
      </p>
      <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[14px] text-ink-muted">
        <li>
          <span className="text-ink">Reload</span> takes the version on the server and discards the changes you
          have here.
        </li>
        <li>
          <span className="text-ink">Save a copy</span> writes your version to a new board next to this one, so
          nothing is lost and you can compare them.
        </li>
      </ul>
    </Dialog>
  );
}
