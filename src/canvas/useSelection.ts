import { useRef, useSyncExternalStore } from 'react';
import type { Id } from '@/domain/board';

/**
 * Live canvas selection, kept outside React's render output.
 *
 * React Flow reports selection the same way it reports everything else: as a
 * stream of changes on `onNodesChange`. A marquee drag emits one batch per
 * pointer move, so anything derived from the node array with `useMemo` takes a
 * new identity on every frame of the gesture — and every callback that lists it
 * as a dependency is rebuilt with it, which is what made a marquee across a
 * 300-node board crawl.
 *
 * Selection here is *read* by commands and only *rendered* as a count, so it
 * lives in a tracker instead: the change stream is folded into a set, the
 * commands read that set when they run, and the one component that has to
 * re-render subscribes to the counts alone.
 */

/**
 * The part of a React Flow change this module reads. Node and edge changes
 * share it structurally, so one reader serves both streams.
 */
export interface SelectionChange {
  readonly type: string;
  readonly id?: string;
  readonly selected?: boolean;
  readonly item?: { readonly id: string; readonly selected?: boolean };
}

/** What the selection looks like from outside — the only value that renders. */
export interface SelectionCounts {
  readonly nodes: number;
  readonly edges: number;
}

const EMPTY: ReadonlySet<Id> = new Set<Id>();

/**
 * Folds a batch of changes into the selected set. The set keeps its identity
 * when the batch does not touch selection, which is what lets a subscriber sit
 * out the frames of a marquee that cross no node.
 */
export function applySelectionChanges(
  current: ReadonlySet<Id>,
  changes: readonly SelectionChange[],
): ReadonlySet<Id> {
  let next: Set<Id> | null = null;

  const want = (id: Id, selected: boolean): void => {
    const view = next ?? current;
    if (view.has(id) === selected) return;
    next ??= new Set(current);
    if (selected) next.add(id);
    else next.delete(id);
  };

  for (const change of changes) {
    switch (change.type) {
      case 'select':
        if (change.id !== undefined) want(change.id, change.selected === true);
        break;
      case 'remove':
        if (change.id !== undefined) want(change.id, false);
        break;
      case 'add':
      case 'replace':
        if (change.item !== undefined) want(change.item.id, change.item.selected === true);
        break;
      default:
        // Position and dimension changes say nothing about selection.
        break;
    }
  }

  return next ?? current;
}

/**
 * Drops ids the document no longer has. Deleting a node does not come back as
 * a React Flow change — the document simply stops listing it — so the tracker
 * is reconciled against the document whenever it changes.
 */
export function retainIds(current: ReadonlySet<Id>, alive: ReadonlySet<Id>): ReadonlySet<Id> {
  let next: Set<Id> | null = null;
  for (const id of current) {
    if (alive.has(id)) continue;
    next ??= new Set(current);
    next.delete(id);
  }
  return next ?? current;
}

/**
 * Stamps a selected set onto flow items, keeping the objects whose flag already
 * agrees — React Flow re-renders exactly the nodes whose identity changed, so
 * touching only the ones that moved in or out of the selection is what keeps a
 * neighbour from re-rendering when its neighbour is selected.
 */
export function withSelectionFlags<T extends { id: Id; selected?: boolean }>(
  items: T[],
  selected: ReadonlySet<Id>,
): T[] {
  let changed = false;
  const next = items.map((item) => {
    const wanted = selected.has(item.id);
    if ((item.selected ?? false) === wanted) return item;
    changed = true;
    return { ...item, selected: wanted };
  });
  return changed ? next : items;
}

/**
 * The selection as a sentence, in the voice the toasts use (spec 8.2). One
 * selected thing wears its own ring and needs no caption, so the count only
 * speaks up once a marquee has caught more than one.
 */
export function describeSelection(counts: SelectionCounts): string | null {
  if (counts.nodes + counts.edges < 2) return null;
  const parts: string[] = [];
  if (counts.nodes > 0) parts.push(counts.nodes === 1 ? '1 node' : `${counts.nodes} nodes`);
  if (counts.edges > 0) parts.push(counts.edges === 1 ? '1 arrow' : `${counts.edges} arrows`);
  return `${parts.join(' and ')} selected`;
}

export interface SelectionTracker {
  /** The selected node ids, as an array built once per change and then reused. */
  nodeIds(): Id[];
  edgeIds(): Id[];
  nodes(): ReadonlySet<Id>;
  edges(): ReadonlySet<Id>;
  /** Referentially stable between changes, so it can drive a subscription. */
  counts(): SelectionCounts;
  readNodeChanges(changes: readonly SelectionChange[]): void;
  readEdgeChanges(changes: readonly SelectionChange[]): void;
  setNodes(ids: Iterable<Id>): void;
  setEdges(ids: Iterable<Id>): void;
  retainNodes(present: readonly { readonly id: Id }[]): void;
  retainEdges(present: readonly { readonly id: Id }[]): void;
  subscribe(listener: () => void): () => void;
}

export function createSelectionTracker(): SelectionTracker {
  let nodes: ReadonlySet<Id> = EMPTY;
  let edges: ReadonlySet<Id> = EMPTY;
  let nodeList: Id[] | null = null;
  let edgeList: Id[] | null = null;
  let counts: SelectionCounts = { nodes: 0, edges: 0 };
  const listeners = new Set<() => void>();

  function commit(nextNodes: ReadonlySet<Id>, nextEdges: ReadonlySet<Id>): void {
    if (nextNodes === nodes && nextEdges === edges) return;
    if (nextNodes !== nodes) {
      nodes = nextNodes;
      nodeList = null;
    }
    if (nextEdges !== edges) {
      edges = nextEdges;
      edgeList = null;
    }
    // Membership can change without the summary changing — a marquee that
    // swaps one node for another must not re-render the count.
    if (counts.nodes === nodes.size && counts.edges === edges.size) return;
    counts = { nodes: nodes.size, edges: edges.size };
    for (const listener of listeners) listener();
  }

  return {
    nodeIds: () => (nodeList ??= [...nodes]),
    edgeIds: () => (edgeList ??= [...edges]),
    nodes: () => nodes,
    edges: () => edges,
    counts: () => counts,
    readNodeChanges: (changes) => commit(applySelectionChanges(nodes, changes), edges),
    readEdgeChanges: (changes) => commit(nodes, applySelectionChanges(edges, changes)),
    setNodes: (ids) => commit(new Set(ids), edges),
    setEdges: (ids) => commit(nodes, new Set(ids)),
    retainNodes: (present) => {
      if (nodes.size === 0) return;
      commit(retainIds(nodes, new Set(present.map((item) => item.id))), edges);
    },
    retainEdges: (present) => {
      if (edges.size === 0) return;
      commit(nodes, retainIds(edges, new Set(present.map((item) => item.id))));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One tracker per mounted canvas, stable for its lifetime. */
export function useSelectionTracker(): SelectionTracker {
  const ref = useRef<SelectionTracker | null>(null);
  ref.current ??= createSelectionTracker();
  return ref.current;
}

/**
 * The narrow subscription: a component using this re-renders when the size of
 * the selection changes and at no other point in a marquee.
 */
export function useSelectionCounts(tracker: SelectionTracker): SelectionCounts {
  return useSyncExternalStore(tracker.subscribe, tracker.counts, tracker.counts);
}
