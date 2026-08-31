import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Id } from '@/domain/board';
import { api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { readLocal, writeLocal } from '@/lib/storage';
import { navigateToBoard, useRoute } from '@/routes';
import { createStarterProject } from '@/board/template';
import BoardShell from '@/board/BoardShell';
import Button from '@/components/Button';

/**
 * Boot: who you are, what boards you have, and which one this URL points at.
 * A truly empty account gets the Appendix A template rather than a blank page,
 * because an empty infinite canvas is the least useful thing this could show.
 */

const LAST_BOARD_KEY = 'karta:last-board';

type Phase =
  | { kind: 'booting'; message: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

function describe(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * The template is a dozen API calls, so it must never be started twice — by the
 * double effect invocation React runs in development, or by a retry that lands
 * while the first attempt is still going.
 */
let starterInFlight: Promise<{ rootId: Id }> | null = null;

function startStarterProject(userId: string, onProgress: (message: string) => void): Promise<{ rootId: Id }> {
  if (!starterInFlight) {
    starterInFlight = createStarterProject({ userId, onProgress }).finally(() => {
      starterInFlight = null;
    });
  }
  return starterInFlight;
}

export default function App(): JSX.Element {
  const { boardId } = useRoute();
  const index = useBoardStore((s) => s.index);
  const [phase, setPhase] = useState<Phase>({ kind: 'booting', message: 'Opening Karta…' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const live = useMemo(
    () => (index?.boards ?? []).filter((board) => board.deletedAt === null),
    [index],
  );

  // Identity, then the index, then — only on an empty account — the template.
  useEffect(() => {
    let cancelled = false;
    const step = (message: string): void => {
      if (!cancelled) setPhase({ kind: 'booting', message });
    };

    const boot = async (): Promise<void> => {
      step('Opening Karta…');

      await useBoardStore.getState().loadMe();
      if (cancelled) return;
      const me = useBoardStore.getState().me;
      if (!me) {
        setPhase({
          kind: 'error',
          message:
            'Could not confirm who you are. If you have just signed in, try again; otherwise sign in and reload.',
        });
        return;
      }

      step('Loading your boards…');
      await useBoardStore.getState().loadIndex();
      if (cancelled) return;

      const state = useBoardStore.getState();
      if (!state.index) {
        setPhase({ kind: 'error', message: state.error ?? 'Could not load your boards.' });
        return;
      }

      if (state.index.boards.every((board) => board.deletedAt !== null)) {
        try {
          const { rootId } = await startStarterProject(me.userId, step);
          if (cancelled) return;
          await useBoardStore.getState().loadIndex();
          if (cancelled) return;
          navigateToBoard(rootId, { replace: true });
        } catch (err) {
          if (cancelled) return;
          setPhase({
            kind: 'error',
            message: `${describe(err, 'Could not create the first board')}. Anything that was created is kept — try again to carry on from there.`,
          });
          return;
        }
      }

      if (!cancelled) setPhase({ kind: 'ready' });
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The URL is the source of truth for which board is open.
  useEffect(() => {
    if (phase.kind !== 'ready' || live.length === 0) return;
    const store = useBoardStore.getState();

    if (boardId !== null) {
      if (store.boardId !== boardId) {
        useUiStore.getState().openEditor(null);
        useUiStore.getState().loadViewForBoard(boardId);
        void store.loadBoard(boardId);
      }
      writeLocal(LAST_BOARD_KEY, boardId);
      return;
    }

    const remembered = readLocal(LAST_BOARD_KEY);
    const target =
      live.find((board) => board.id === remembered) ??
      live.find((board) => board.parentBoardId === null) ??
      live[0];
    if (target) navigateToBoard(target.id, { replace: true });
  }, [phase, boardId, live]);

  if (phase.kind === 'booting') return <BootScreen message={phase.message} />;
  if (phase.kind === 'error') return <ErrorScreen message={phase.message} onRetry={retry} />;
  if (live.length === 0) return <NoBoardsScreen />;
  return <BoardShell />;
}

function Frame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="grid h-screen w-screen place-items-center bg-canvas px-6 text-ink">
      <div className="flex w-full max-w-[42ch] flex-col items-start gap-3">
        <h1 className="font-condensed text-[22px] font-semibold">Karta</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Every board was deleted while the app was open. Boot created the template on a
 * genuinely empty account, so this is only reachable by deleting them by hand —
 * and it must not be a dead end.
 */
function NoBoardsScreen(): JSX.Element {
  const loadIndex = useBoardStore((s) => s.loadIndex);
  const userId = useBoardStore((s) => s.me?.userId ?? '');
  const [busy, setBusy] = useState<'blank' | 'template' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (kind: 'blank' | 'template', make: () => Promise<Id>): Promise<void> => {
    if (busy !== null) return;
    setBusy(kind);
    setFailure(null);
    try {
      const id = await make();
      await loadIndex();
      navigateToBoard(id, { replace: true });
    } catch (err) {
      setFailure(describe(err, 'Could not create the board'));
      setBusy(null);
    }
  };

  return (
    <Frame>
      <p className="text-[15px] text-ink">You have no boards.</p>
      {failure ? <p className="text-[14px] text-[var(--temper-copper)]">{failure}</p> : null}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={busy !== null}
          onClick={() =>
            void run('blank', async () => (await api.createBoard({ title: 'New board' })).doc.id)
          }
        >
          {busy === 'blank' ? 'Creating…' : 'New board'}
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() =>
            void run('template', async () => (await createStarterProject({ userId })).rootId)
          }
        >
          {busy === 'template' ? 'Creating…' : 'New board from template'}
        </Button>
      </div>
    </Frame>
  );
}

function BootScreen({ message }: { message: string }): JSX.Element {
  return (
    <Frame>
      <p className="text-[15px] text-ink-muted" aria-live="polite">
        {message}
      </p>
    </Frame>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry(): void }): JSX.Element {
  return (
    <Frame>
      <p className="text-[15px] text-ink">Karta could not start.</p>
      <p className="text-[14px] text-ink-muted">{message}</p>
      <Button variant="primary" onClick={onRetry}>
        Try again
      </Button>
    </Frame>
  );
}
