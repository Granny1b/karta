import { useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Id } from '@/domain/board';
import { formatRelative } from '@/lib/format';
import { isEditableTarget, matchShortcut } from '@/lib/keys';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { CanvasProvider } from '@/canvas/CanvasContext';
import Canvas from '@/canvas/Canvas';
import KanbanView from '@/kanban/KanbanView';
import CardEditorPanel from '@/card/CardEditorPanel';
import LabelEditor from '@/card/LabelEditor';
import StatusEditor from '@/kanban/StatusEditor';
import ImportDialog from '@/io/ImportDialog';
import ExportDialog from '@/io/ExportDialog';
import TopBar from '@/board/TopBar';
import SidebarTree from '@/board/SidebarTree';
import ConflictDialog from '@/board/ConflictDialog';
import SearchDialog from '@/board/SearchDialog';
import SnapshotsDialog from '@/board/SnapshotsDialog';
import ShortcutsDialog from '@/board/ShortcutsDialog';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import EmptyState from '@/components/EmptyState';
import Toasts from '@/components/Toasts';
import { navigateToBoard } from '@/routes';

/**
 * The frame around the board: one 48 px bar, one surface below it that fills the
 * window, and everything else — sidebar, editor, dialogs — layered over that
 * surface so switching views or boards never resizes the canvas (spec 8.3).
 */
export default function BoardShell(): JSX.Element {
  const view = useUiStore((s) => s.view);
  const dialog = useUiStore((s) => s.dialog);
  const doc = useBoardStore((s) => s.doc);
  const loading = useBoardStore((s) => s.loading);
  const error = useBoardStore((s) => s.error);
  const walRecovery = useBoardStore((s) => s.walRecovery);

  useShellShortcuts();

  const navigate = useCallback((boardId: Id) => navigateToBoard(boardId), []);

  return (
    <CanvasProvider navigateToBoard={navigate}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink">
        <TopBar />

        <main className="relative min-h-0 flex-1">
          {loading || (!doc && error === null) ? (
            // No document and no error yet means the load has not started; the
            // shell must not accuse the board of failing before it was asked for.
            <p className="grid h-full place-items-center text-ui text-ink-muted">Loading the board…</p>
          ) : !doc ? (
            <BoardError message={error} />
          ) : walRecovery ? (
            // Spec 7.5: the choice is offered before the board is drawn, so the
            // first thing on screen is never the version about to be replaced.
            <div className="h-full bg-canvas" />
          ) : view === 'canvas' ? (
            <Canvas />
          ) : (
            <KanbanView />
          )}

          <NewerVersionChip />
          <SidebarTree />
        </main>

        <CardEditorPanel />

        {dialog === 'import' ? <ImportDialog /> : null}
        {dialog === 'export' ? <ExportDialog /> : null}
        {dialog === 'search' ? <SearchDialog /> : null}
        {dialog === 'shortcuts' ? <ShortcutsDialog /> : null}
        {dialog === 'snapshots' ? <SnapshotsDialog /> : null}
        {/* Board-level lists, drawn here rather than inside the panel or popover
            that asked for them: a dialog nested in a transformed ancestor is
            positioned against it, and clipped to it. */}
        {dialog === 'labels' ? <LabelEditor /> : null}
        {dialog === 'statuses' ? <StatusEditor /> : null}

        <ConflictDialog />
        <WalRecoveryPrompt />
        <Toasts />
      </div>
    </CanvasProvider>
  );
}

/**
 * A board that would not open. The shell stays up around it, because the board
 * list is the fastest way out of this.
 */
function BoardError({ message }: { message: string | null }): JSX.Element {
  const boardId = useBoardStore((s) => s.boardId);
  const loadBoard = useBoardStore((s) => s.loadBoard);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        title="Could not open this board"
        hint={message ?? 'It may have been deleted, or the connection dropped.'}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!boardId}
              onClick={() => {
                if (boardId) void loadBoard(boardId);
              }}
            >
              Try again
            </Button>
            <Button onClick={() => setSidebarOpen(true)}>Show the board list</Button>
          </div>
        }
      />
    </div>
  );
}

/**
 * The half of the keyboard table that is not canvas-scoped (spec 9). The canvas
 * owns creation, selection, colour and zoom; the shell owns the view toggle,
 * undo, search, and what Escape closes.
 */
function useShellShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const ui = useUiStore.getState();
      const board = useBoardStore.getState();

      if (e.key === 'Escape') {
        // Outermost first, and one layer per press. The editor panel closes
        // itself, so it is only skipped over here.
        if (ui.dialog !== null) return;
        if (ui.editorNodeId !== null) return;
        if (ui.sidebarOpen) {
          ui.setSidebarOpen(false);
          e.preventDefault();
        }
        return;
      }

      // A dialog or the recovery prompt owns the keyboard while it is open.
      if (ui.dialog !== null || board.walRecovery !== null || board.saveState === 'conflict') return;

      if (e.key === '?' && !isEditableTarget(e.target)) {
        e.preventDefault();
        ui.setDialog('shortcuts');
        return;
      }

      const action = matchShortcut(e);
      if (action === null) return;

      switch (action) {
        case 'toggle-view': {
          // Tab is still Tab inside a panel: it has to be able to walk fields.
          const target = e.target;
          if (target instanceof Element && target.closest('aside,[role="dialog"]')) return;
          e.preventDefault();
          ui.toggleView();
          break;
        }
        case 'undo':
          e.preventDefault();
          board.undo();
          break;
        case 'redo':
          e.preventDefault();
          board.redo();
          break;
        case 'search':
          e.preventDefault();
          ui.setDialog('search');
          break;
        default:
          // Everything else belongs to the canvas.
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Spec 6.4: the index says this board moved while local work is unsaved. */
function NewerVersionChip(): JSX.Element | null {
  const newerAvailable = useBoardStore((s) => s.newerAvailable);
  const saveState = useBoardStore((s) => s.saveState);
  const save = useBoardStore((s) => s.save);

  if (!newerAvailable) return null;

  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-md border border-line bg-raised px-2 py-1.5 text-caption text-ink-muted shadow-overlay">
      <RefreshCw size={14} aria-hidden />
      <span>A newer version of this board exists.</span>
      <Button size="sm" disabled={saveState === 'saving'} onClick={() => void save(true)}>
        Merge it in
      </Button>
    </div>
  );
}

/** Spec 7.5: unsaved work found in IndexedDB, newer than the server's copy. */
function WalRecoveryPrompt(): JSX.Element | null {
  const walRecovery = useBoardStore((s) => s.walRecovery);
  const accept = useBoardStore((s) => s.acceptWalRecovery);
  const discard = useBoardStore((s) => s.discardWalRecovery);

  if (!walRecovery) return null;

  return (
    <Dialog
      title="Restore unsaved changes?"
      width="sm"
      dismissible={false}
      onClose={discard}
      footer={
        <>
          <Button onClick={discard}>Discard them</Button>
          <Button variant="primary" onClick={accept}>
            Restore
          </Button>
        </>
      }
    >
      <p className="text-ui text-ink-muted">
        This browser holds changes to this board from {formatRelative(walRecovery.savedAt)} that never reached
        the server — the tab was probably closed, or the connection dropped, before they could be saved.
      </p>
      <p className="mt-3 text-ui text-ink-muted">
        Restoring puts them back and saves them. Discarding keeps the version on the server.
      </p>
    </Dialog>
  );
}
