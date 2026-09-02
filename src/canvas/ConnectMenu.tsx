import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import type { ConnectChoice } from '@/canvas/connect';
import { PaletteMenuItems } from '@/canvas/Palette';

export interface ConnectMenuProps {
  /** Position within the canvas wrapper, in pixels. */
  x: number;
  y: number;
  /**
   * What the menu is for, in the words the caller would use — the same picker
   * serves an arrow looking for something to point at and a right-click on
   * empty canvas, and it should say which of the two it is.
   */
  title?: string;
  onPick(choice: ConnectChoice): void;
  /**
   * Offered only when the menu was opened on bare canvas. A nested board is
   * created on the server before its tile can exist, so it cannot be the target
   * of the arrow that opened this menu the way the synchronous kinds can.
   */
  onNewBoard?: () => void;
  onCancel(): void;
}

/** Kept clear of the canvas edge so the menu never opens half off-screen. */
const EDGE_MARGIN = 8;

/**
 * What goes here (spec 7.3): the menu an arrow opens where it was let go, and
 * the one the right button opens on bare canvas. Either way the arrow gesture
 * and the pointer are also the fastest way to make the next thing — a card, a
 * sticky, a line of text, or any of the shapes.
 *
 * The list itself is the palette's, item for item, because this is the palette's
 * question asked somewhere else.
 */
export default function ConnectMenu({
  x,
  y,
  title = 'Add and connect',
  onPick,
  onNewBoard,
  onCancel,
}: ConnectMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  // Measured before paint: the menu is a fixed size, so where it can sit is
  // known as soon as it exists and it never has to be seen moving.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent;
    if (!el || !(parent instanceof HTMLElement)) return;
    const maxLeft = Math.max(EDGE_MARGIN, parent.clientWidth - el.offsetWidth - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, parent.clientHeight - el.offsetHeight - EDGE_MARGIN);
    setAt({
      left: Math.min(Math.max(x, EDGE_MARGIN), maxLeft),
      top: Math.min(Math.max(y, EDGE_MARGIN), maxTop),
    });
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onCancel();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onCancel]);

  return (
    <div ref={ref} className="karta-connect-menu nodrag nopan" style={at} role="menu" aria-label={title}>
      <p className="karta-menu-title" aria-hidden>
        {title}
      </p>

      <PaletteMenuItems onPick={(entry) => onPick(entry.choice)} />

      {onNewBoard && (
        <>
          <hr className="my-2 border-line" />
          <button
            type="button"
            role="menuitem"
            className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-caption text-ink transition-colors duration-fast ease-linear hover:bg-hover"
            onClick={onNewBoard}
          >
            <span className="flex h-3.5 w-5 shrink-0 items-center justify-center">
              <FolderPlus size={14} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate">Nested board</span>
            <span className="shrink-0 text-meta leading-flat text-ink-muted">B</span>
          </button>
        </>
      )}

      <hr className="my-2 border-line" />

      <button
        type="button"
        role="menuitem"
        className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-caption text-ink-muted transition-colors duration-fast ease-linear hover:bg-hover hover:text-ink"
        onClick={onCancel}
      >
        <span className="flex h-3.5 w-5 shrink-0 items-center justify-center">
          <X size={14} aria-hidden />
        </span>
        Cancel
      </button>
    </div>
  );
}
