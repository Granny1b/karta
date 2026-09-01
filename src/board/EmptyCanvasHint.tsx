import { useEffect, useState } from 'react';
import { useBoardStore } from '@/state/boardStore';

/**
 * The empty board (spec 8.4).
 *
 * The spec's single line is kept, because double-clicking is still the fastest
 * way in, but a person who has never seen this board cannot guess the other two
 * — so the palette and the paste both get a line. Three quiet lines in
 * `--ink-muted`, no illustration, no modal, nothing to dismiss: it goes away by
 * the board stopping being empty.
 *
 * It never intercepts the pointer, so "double-click anywhere" includes the words
 * themselves.
 */

/** Clear of `--dur-base` with room to spare, so the unmount never cuts the fade. */
const FADE_MS = 240;

export default function EmptyCanvasHint(): JSX.Element | null {
  const empty = useBoardStore((s) => (s.doc?.nodes.length ?? 0) === 0);

  // Held one beat past the first node so the fade has something to fade, then
  // dropped. A board that opens with nodes never mounts this at all, which is
  // what keeps the fade from running backwards as an entrance (8.3).
  const [visible, setVisible] = useState(empty);

  useEffect(() => {
    if (empty) {
      setVisible(true);
      return undefined;
    }
    const timer = setTimeout(() => setVisible(false), FADE_MS);
    return () => clearTimeout(timer);
  }, [empty]);

  if (!visible) return null;

  return (
    <div
      aria-hidden={!empty}
      className={`pointer-events-none absolute left-1/2 top-1/2 w-[42ch] max-w-[80%] -translate-x-1/2 -translate-y-1/2 select-none text-center text-ink-muted transition-opacity duration-[var(--dur-base)] ease-linear ${
        empty ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <p className="text-[15px]">Double-click anywhere to add a card.</p>
      <p className="mt-2 text-[13px]">
        Or take a card, note, text or shape from the palette on the left — click it to drop it in the
        middle, or drag it exactly where you want it.
      </p>
      <p className="mt-1 text-[13px]">Paste a screenshot with Ctrl+V and it lands at the pointer.</p>
    </div>
  );
}
