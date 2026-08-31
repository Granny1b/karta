import { describe, expect, it } from 'vitest';
import { createSelectionTracker } from '@/canvas/useSelection';
import { soleEdge, soleNode } from '@/canvas/soleSelection';

/**
 * The gate the resize handles and the arrow editor sit behind.
 *
 * What matters is not only the answer but how seldom it changes: a marquee is
 * sixty frames of shifting selection, and every change of the *answer* is a
 * re-render of every affordance watching it. Gated on each item's own
 * `selected` flag, a sweep mounted one twelve-control resizer per node caught
 * and one editing panel per arrow; gated on the count, it mounts one, and only
 * while the selection really is one thing.
 */

describe('soleNode and soleEdge', () => {
  it('answer for a selection of exactly one, of their own kind', () => {
    expect(soleNode({ nodes: 1, edges: 0 })).toBe(true);
    // An arrow caught alongside its node does not take the handles away.
    expect(soleNode({ nodes: 1, edges: 4 })).toBe(true);
    expect(soleNode({ nodes: 0, edges: 1 })).toBe(false);
    expect(soleNode({ nodes: 2, edges: 0 })).toBe(false);

    expect(soleEdge({ nodes: 0, edges: 1 })).toBe(true);
    expect(soleEdge({ nodes: 3, edges: 1 })).toBe(true);
    expect(soleEdge({ nodes: 1, edges: 0 })).toBe(false);
    expect(soleEdge({ nodes: 0, edges: 40 })).toBe(false);
  });
});

describe('a marquee, watched through the gate', () => {
  it('changes the answer twice and then holds it for the rest of the gesture', () => {
    const tracker = createSelectionTracker();
    let answer = soleNode(tracker.counts());
    const flips: boolean[] = [];
    tracker.subscribe(() => {
      const next = soleNode(tracker.counts());
      if (next === answer) return;
      answer = next;
      flips.push(next);
    });

    // One more node swept into the rectangle on each of sixty frames.
    for (let frame = 0; frame < 60; frame += 1) {
      tracker.readNodeChanges([{ type: 'select', id: `n${frame}`, selected: true }]);
    }

    expect(tracker.counts().nodes).toBe(60);
    // On as the first node is caught, off as the second joins it, then nothing.
    expect(flips).toEqual([true, false]);
    expect(answer).toBe(false);
  });

  it('leaves the node answer alone while it is catching arrows', () => {
    const tracker = createSelectionTracker();
    tracker.readNodeChanges([{ type: 'select', id: 'n0', selected: true }]);

    let answer = soleNode(tracker.counts());
    let flips = 0;
    tracker.subscribe(() => {
      const next = soleNode(tracker.counts());
      if (next === answer) return;
      answer = next;
      flips += 1;
    });

    for (let i = 0; i < 40; i += 1) {
      tracker.readEdgeChanges([{ type: 'select', id: `e${i}`, selected: true }]);
    }

    expect(tracker.counts()).toEqual({ nodes: 1, edges: 40 });
    expect(flips).toBe(0);
    expect(answer).toBe(true);
  });

  it('gives the affordance back the moment the selection is one thing again', () => {
    const tracker = createSelectionTracker();
    tracker.setNodes(['a', 'b', 'c']);
    tracker.setEdges(['e1', 'e2']);
    expect(soleNode(tracker.counts())).toBe(false);
    expect(soleEdge(tracker.counts())).toBe(false);

    // A click on one node: the marquee's crowd is dropped with it.
    tracker.setNodes(['b']);
    tracker.setEdges([]);
    expect(soleNode(tracker.counts())).toBe(true);
    expect(soleEdge(tracker.counts())).toBe(false);

    tracker.setNodes([]);
    tracker.setEdges(['e1']);
    expect(soleNode(tracker.counts())).toBe(false);
    expect(soleEdge(tracker.counts())).toBe(true);
  });
});
