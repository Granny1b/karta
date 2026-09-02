import { useState } from 'react';
import { describeContents, type DoomedBoard } from '@/canvas/deleteBoards';
import Dialog from '@/components/Dialog';
import Button from '@/components/Button';

/**
 * The safety question before a board goes with its link.
 *
 * Deleting a tile the size of a card can take a board full of work with it, so
 * a board holding anything is worth stopping for. The two ways forward are both
 * offered plainly, because either can be what was meant: take the board too, or
 * take only the doorway and leave the board in the sidebar.
 *
 * Only reached when something would actually be lost — deleting links to empty
 * boards does not ask, since there is nothing to warn about.
 */
export default function DeleteBoardsDialog({
  boards,
  onCancel,
  onDeleteBoards,
  onKeepBoards,
}: {
  boards: readonly DoomedBoard[];
  onCancel(): void;
  onDeleteBoards(): void | Promise<void>;
  onKeepBoards(): void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const many = boards.length > 1;

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onDeleteBoards();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={many ? 'Delete these boards?' : 'Delete this board?'} width="sm" onClose={onCancel}>
      <p className="text-ui text-ink">
        {many
          ? 'These boards are not empty. Deleting them removes everything on them.'
          : 'This board is not empty. Deleting it removes everything on it.'}
      </p>

      <ul className="mt-3 flex flex-col gap-1">
        {boards.map((board) => (
          <li
            key={board.boardId}
            className="flex items-baseline justify-between gap-3 rounded-md border border-line px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-ui text-ink">{board.title}</span>
            <span className="shrink-0 text-control text-ink-muted">{describeContents(board)}</span>
          </li>
        ))}
      </ul>

      {boards.some((b) => b.children > 0) ? (
        <p className="mt-3 text-caption text-ink-muted">
          Boards nested inside are not deleted. They stay in the sidebar.
        </p>
      ) : null}

      <p className="mt-3 text-caption text-ink-muted">
        Storage keeps a deleted board for 14 days, so this is recoverable.
      </p>

      <footer className="mt-4 flex items-center justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onKeepBoards}>{many ? 'Remove links only' : 'Remove the link only'}</Button>
        <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Deleting…' : many ? 'Delete boards' : 'Delete the board'}
        </Button>
      </footer>
    </Dialog>
  );
}
