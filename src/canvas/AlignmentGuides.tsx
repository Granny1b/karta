import { memo, useSyncExternalStore } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { Guide } from '@/canvas/alignment';

/**
 * The lines a drag is snapping to.
 *
 * These change on every frame of a drag, so they are deliberately kept out of
 * the canvas component's render output: putting them in `useState` there would
 * re-render the whole flow subtree sixty times a second and undo the work that
 * made a marquee usable. The tracker is an external store and only this
 * component subscribes, exactly as `useSelection` does for the selection count.
 */

export interface GuideTracker {
  set(guides: readonly Guide[]): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
  read(): readonly Guide[];
}

const NONE: readonly Guide[] = [];

export function createGuideTracker(): GuideTracker {
  let guides: readonly Guide[] = NONE;
  const listeners = new Set<() => void>();

  const publish = (next: readonly Guide[]): void => {
    // Identity is the subscription signal, so an unchanged frame must not
    // produce a new array — most frames of a drag snap to nothing at all.
    if (guides === next) return;
    if (guides.length === 0 && next.length === 0) return;
    guides = next;
    for (const listener of listeners) listener();
  };

  return {
    set: (next) => publish(next.length === 0 ? NONE : next),
    clear: () => publish(NONE),
    read: () => guides,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Drawn inside the viewport portal, so the lines live in flow coordinates and
 * pan and zoom with the board without any arithmetic here. Their thickness is
 * counter-scaled by the stylesheet so a guide stays hairline at every zoom.
 */
function AlignmentGuidesView({ tracker }: { tracker: GuideTracker }): JSX.Element | null {
  const guides = useSyncExternalStore(tracker.subscribe, tracker.read, tracker.read);
  if (guides.length === 0) return null;

  return (
    <ViewportPortal>
      {guides.map((guide) => {
        const vertical = guide.axis === 'x';
        return (
          <div
            key={`${guide.axis}:${guide.at}:${guide.from}`}
            className="karta-guide"
            aria-hidden
            style={{
              position: 'absolute',
              transform: `translate(${vertical ? guide.at : guide.from}px, ${
                vertical ? guide.from : guide.at
              }px)`,
              width: vertical ? 0 : guide.to - guide.from,
              height: vertical ? guide.to - guide.from : 0,
            }}
          />
        );
      })}
    </ViewportPortal>
  );
}

export default memo(AlignmentGuidesView);
