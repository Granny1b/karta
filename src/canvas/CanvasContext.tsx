import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Id } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';

/**
 * The canvas needs one thing from its host: how to move to another board when a
 * `boardLink` node is opened (spec 7.3). The shell owns the URL, so it provides
 * the callback; without a provider the canvas still navigates, by asking the
 * page first and falling back to loading the board in place.
 */
export interface CanvasApi {
  navigateToBoard(boardId: Id): void;
}

export const NAVIGATE_EVENT = 'karta:navigate';

/** `event.preventDefault()` in a listener means "the host handled this". */
export function defaultNavigate(boardId: Id): void {
  if (typeof window !== 'undefined') {
    const event = new CustomEvent<{ boardId: Id }>(NAVIGATE_EVENT, {
      detail: { boardId },
      cancelable: true,
    });
    if (!window.dispatchEvent(event)) return;
  }
  const store = useBoardStore.getState();
  if (store.boardId !== boardId) void store.loadBoard(boardId);
}

const FALLBACK: CanvasApi = { navigateToBoard: defaultNavigate };

const CanvasContext = createContext<CanvasApi | null>(null);

export function CanvasProvider({
  navigateToBoard,
  children,
}: {
  navigateToBoard: (boardId: Id) => void;
  children: ReactNode;
}): JSX.Element {
  const value = useMemo<CanvasApi>(() => ({ navigateToBoard }), [navigateToBoard]);
  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvasApi(): CanvasApi {
  return useContext(CanvasContext) ?? FALLBACK;
}
