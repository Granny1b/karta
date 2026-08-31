import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { SelectionCounts } from '@/canvas/useSelection';

/**
 * "Is this the only thing selected?" — the question an affordance that belongs
 * to one item has to ask before it mounts.
 *
 * A marquee selects everything it crosses, and the resize handles and the arrow
 * editor were both gated on an item's own `selected` flag. So a sweep across a
 * board mounted a twelve-control resizer on every node it caught and a full
 * editing panel on every arrow — thousands of React Flow store subscriptions
 * and drag behaviours, built and torn down again as the rectangle grew. Neither
 * affordance means anything on a crowd: a resize handle sizes one node and a
 * routing choice routes one arrow. So both are gated on the selection being
 * exactly that one item.
 *
 * The counts come from the canvas's own selection tracker, which notifies only
 * when a count changes, and what is read out of it here is a boolean — so the
 * frames of a marquee that leave the answer at `false` re-render nothing.
 */

/** The part of the canvas's selection tracker this module reads. */
export interface SelectionCountsSource {
  counts(): SelectionCounts;
  subscribe(listener: () => void): () => void;
}

/**
 * Provided by the canvas surface. Without a provider — a node rendered outside
 * a board, or in a test — every item is treated as its own selection, which is
 * the behaviour these affordances had before the gate existed.
 */
export const SelectionScope = createContext<SelectionCountsSource | null>(null);

/** Exactly one node is selected, whatever else is going on with the arrows. */
export function soleNode(counts: SelectionCounts): boolean {
  return counts.nodes === 1;
}

/** Exactly one arrow is selected, whatever else is going on with the nodes. */
export function soleEdge(counts: SelectionCounts): boolean {
  return counts.edges === 1;
}

/** No provider, no changes to hear about. */
function neverChanges(): () => void {
  return () => undefined;
}

function useSole(read: (counts: SelectionCounts) => boolean): boolean {
  const source = useContext(SelectionScope);
  const snapshot = useCallback(
    (): boolean => (source === null ? true : read(source.counts())),
    [read, source],
  );
  return useSyncExternalStore(source?.subscribe ?? neverChanges, snapshot, snapshot);
}

/** True while this node is the whole node selection. */
export function useSoleNodeSelected(): boolean {
  return useSole(soleNode);
}

/** True while this arrow is the whole arrow selection. */
export function useSoleEdgeSelected(): boolean {
  return useSole(soleEdge);
}
