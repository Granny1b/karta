import { describe, expect, it, vi } from 'vitest';
import {
  applySelectionChanges,
  createSelectionTracker,
  describeSelection,
  retainIds,
  withSelectionFlags,
  type SelectionChange,
} from '@/canvas/useSelection';

const select = (id: string, selected: boolean): SelectionChange => ({ type: 'select', id, selected });

describe('applySelectionChanges', () => {
  it('folds select changes into the set', () => {
    const next = applySelectionChanges(new Set(['a']), [select('b', true), select('a', false)]);
    expect([...next]).toEqual(['b']);
  });

  it('keeps the set identity when nothing selection-relevant happened', () => {
    const current = new Set(['a']);
    const changes: SelectionChange[] = [
      { type: 'position', id: 'a' },
      { type: 'dimensions', id: 'b' },
    ];
    expect(applySelectionChanges(current, changes)).toBe(current);
  });

  it('keeps the set identity when a change repeats what is already true', () => {
    const current = new Set(['a']);
    expect(applySelectionChanges(current, [select('a', true), select('b', false)])).toBe(current);
  });

  it('drops a removed id', () => {
    const next = applySelectionChanges(new Set(['a', 'b']), [{ type: 'remove', id: 'a' }]);
    expect([...next]).toEqual(['b']);
  });

  it('reads selection off an added or replaced item', () => {
    const next = applySelectionChanges(new Set<string>(), [
      { type: 'add', item: { id: 'a', selected: true } },
      { type: 'replace', id: 'b', item: { id: 'b', selected: true } },
    ]);
    expect([...next]).toEqual(['a', 'b']);
  });

  it('applies a whole marquee batch in one pass', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `n${i}`);
    const next = applySelectionChanges(
      new Set<string>(),
      ids.map((id) => select(id, true)),
    );
    expect(next.size).toBe(50);
  });
});

describe('retainIds', () => {
  it('drops ids the document no longer has', () => {
    expect([...retainIds(new Set(['a', 'b']), new Set(['b']))]).toEqual(['b']);
  });

  it('keeps the identity when everything is still there', () => {
    const current = new Set(['a', 'b']);
    expect(retainIds(current, new Set(['a', 'b', 'c']))).toBe(current);
  });
});

describe('withSelectionFlags', () => {
  it('only replaces the items whose flag disagrees', () => {
    const items = [
      { id: 'a', selected: true },
      { id: 'b', selected: false },
      { id: 'c', selected: false },
    ];
    const next = withSelectionFlags(items, new Set(['a', 'c']));

    expect(next).not.toBe(items);
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toBe(items[1]);
    expect(next[2]).not.toBe(items[2]);
    expect(next[2]?.selected).toBe(true);
  });

  it('keeps the array identity when every flag already agrees', () => {
    const items = [{ id: 'a', selected: true }, { id: 'b' }];
    expect(withSelectionFlags(items, new Set(['a']))).toBe(items);
  });
});

describe('describeSelection', () => {
  it('says nothing about no selection or a single one', () => {
    expect(describeSelection({ nodes: 0, edges: 0 })).toBeNull();
    expect(describeSelection({ nodes: 1, edges: 0 })).toBeNull();
    expect(describeSelection({ nodes: 0, edges: 1 })).toBeNull();
  });

  it('counts nodes and arrows in sentence case', () => {
    expect(describeSelection({ nodes: 4, edges: 0 })).toBe('4 nodes selected');
    expect(describeSelection({ nodes: 0, edges: 3 })).toBe('3 arrows selected');
    expect(describeSelection({ nodes: 1, edges: 1 })).toBe('1 node and 1 arrow selected');
    expect(describeSelection({ nodes: 3, edges: 2 })).toBe('3 nodes and 2 arrows selected');
  });
});

describe('createSelectionTracker', () => {
  it('reads node and edge changes independently', () => {
    const tracker = createSelectionTracker();
    tracker.readNodeChanges([select('a', true), select('b', true)]);
    tracker.readEdgeChanges([select('e1', true)]);

    expect(tracker.nodeIds()).toEqual(['a', 'b']);
    expect(tracker.edgeIds()).toEqual(['e1']);
    expect(tracker.counts()).toEqual({ nodes: 2, edges: 1 });
  });

  it('reuses the id array until the selection changes', () => {
    const tracker = createSelectionTracker();
    tracker.setNodes(['a', 'b']);
    const first = tracker.nodeIds();

    expect(tracker.nodeIds()).toBe(first);
    tracker.readNodeChanges([select('c', true)]);
    expect(tracker.nodeIds()).not.toBe(first);
  });

  it('keeps the counts object stable while only membership changes', () => {
    const tracker = createSelectionTracker();
    tracker.setNodes(['a']);
    const counts = tracker.counts();

    tracker.readNodeChanges([select('a', false), select('b', true)]);
    expect(tracker.nodeIds()).toEqual(['b']);
    expect(tracker.counts()).toBe(counts);
  });

  it('notifies only when a count changes', () => {
    const tracker = createSelectionTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);

    tracker.readNodeChanges([select('a', true)]);
    expect(listener).toHaveBeenCalledTimes(1);

    // A marquee frame that crosses nothing.
    tracker.readNodeChanges([{ type: 'position', id: 'a' }]);
    expect(listener).toHaveBeenCalledTimes(1);

    // A marquee frame that swaps one node for another.
    tracker.readNodeChanges([select('a', false), select('b', true)]);
    expect(listener).toHaveBeenCalledTimes(1);

    tracker.readNodeChanges([select('c', true)]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying an unsubscribed listener', () => {
    const tracker = createSelectionTracker();
    const listener = vi.fn();
    tracker.subscribe(listener)();

    tracker.setNodes(['a']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('prunes ids the document has dropped', () => {
    const tracker = createSelectionTracker();
    tracker.setNodes(['a', 'b']);
    tracker.setEdges(['e1']);

    tracker.retainNodes([{ id: 'b' }]);
    tracker.retainEdges([]);

    expect(tracker.nodeIds()).toEqual(['b']);
    expect(tracker.edgeIds()).toEqual([]);
  });

  it('does no work pruning an empty selection', () => {
    const tracker = createSelectionTracker();
    const before = tracker.nodes();
    tracker.retainNodes([{ id: 'a' }]);
    expect(tracker.nodes()).toBe(before);
  });
});
