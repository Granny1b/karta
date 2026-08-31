import { useEffect, useRef } from 'react';
import { SquarePlus, StickyNote, X } from 'lucide-react';

export interface ConnectMenuProps {
  /** Position within the canvas wrapper, in pixels. */
  x: number;
  y: number;
  onPick(kind: 'card' | 'note'): void;
  onCancel(): void;
}

/**
 * Dropping an arrow on empty canvas asks what should be there (spec 7.3), so
 * the arrow gesture is also the fastest way to make the next card.
 */
export default function ConnectMenu({ x, y, onPick, onCancel }: ConnectMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

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
    <div ref={ref} className="karta-connect-menu nodrag nopan" style={{ left: x, top: y }} role="menu">
      <button type="button" role="menuitem" className="karta-menu-item" onClick={() => onPick('card')}>
        <SquarePlus size={14} aria-hidden />
        New card here
      </button>
      <button type="button" role="menuitem" className="karta-menu-item" onClick={() => onPick('note')}>
        <StickyNote size={14} aria-hidden />
        New note here
      </button>
      <button type="button" role="menuitem" className="karta-menu-item" onClick={onCancel}>
        <X size={14} aria-hidden />
        Cancel
      </button>
    </div>
  );
}
