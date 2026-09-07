import { describe, expect, it } from 'vitest';
import {
  draggedNode,
  inView,
  isSettling,
  neighboursOf,
  snapToNeighbours,
  stepFrom,
  type Rect,
} from '@/canvas/alignment';

const rect = (id: string, x: number, y: number, w = 240, h = 140): Rect => ({ id, x, y, w, h });

describe('snapToNeighbours', () => {
  it('leaves a node alone when nothing is near', () => {
    const moving = rect('a', 0, 0);
    const result = snapToNeighbours(moving, [rect('b', 900, 900)], { threshold: 8 });

    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.guides).toEqual([]);
  });

  it('lines up two left edges that are nearly level', () => {
    const result = snapToNeighbours(rect('a', 103, 400), [rect('b', 100, 0)], { threshold: 8 });
    expect(result.x).toBe(100);
  });

  it('straightens the arrow between two nodes of different heights', () => {
    // The whole reason this module exists: a handle sits at the midpoint of a
    // side, so a horizontal arrow is straight only when the centres match. A
    // 140-tall card beside a 100-tall shape cannot get there on a grid.
    const card = rect('card', 0, 0, 240, 140); // centre y = 70
    const shape = rect('shape', 400, 45, 160, 100); // centre y = 95, 25 out

    const result = snapToNeighbours(shape, [card], {
      threshold: 6,
      connected: new Set(['card']),
      connectedThreshold: 30,
    });

    expect(result.y + shape.h / 2).toBe(card.y + card.h / 2);
    expect(result.guides.some((g) => g.axis === 'y')).toBe(true);
  });

  it('does not reach that far for a node with no arrow to it', () => {
    const card = rect('card', 0, 0, 240, 140);
    const shape = rect('shape', 400, 45, 160, 100);

    // Same geometry, but nothing connects them, so the wide catch does not
    // apply and the centres stay 25 apart.
    const result = snapToNeighbours(shape, [card], {
      threshold: 3,
      connected: new Set(),
      connectedThreshold: 30,
    });

    expect(result.y).toBe(shape.y);
  });

  it('prefers a connected neighbour when two are equally close', () => {
    const moving = rect('m', 0, 100);
    const plain = rect('plain', 500, 92);
    const wired = rect('wired', 900, 108);

    const result = snapToNeighbours(moving, [plain, wired], {
      threshold: 16,
      connected: new Set(['wired']),
      connectedThreshold: 16,
    });

    expect(result.y).toBe(108);
  });

  it('snaps both axes at once and reports a guide for each', () => {
    const result = snapToNeighbours(rect('a', 97, 203), [rect('b', 100, 200)], { threshold: 8 });

    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });

  it('draws each guide across both rectangles', () => {
    const moving = rect('a', 100, 500, 240, 140);
    const other = rect('b', 100, 0, 240, 140);
    const result = snapToNeighbours(moving, [other], { threshold: 8 });

    const guide = result.guides.find((g) => g.axis === 'x');
    expect(guide).toBeDefined();
    expect(guide?.from).toBe(0); // the top of the far rectangle
    expect(guide?.to).toBe(640); // the bottom of the dragged one
  });

  it('takes the nearest of every line a neighbour offers', () => {
    // The dragged node's LEFT edge (123) is 3 from the neighbour's CENTRE
    // (120); its own centre is 53 away. Alignment is between any pair of
    // lines, not centre to centre, so the near pair wins.
    const result = snapToNeighbours(rect('a', 123, 0, 100, 100), [rect('b', 0, 0, 240, 100)], {
      threshold: 8,
    });
    expect(result.x).toBe(120);
  });
});

describe('neighboursOf', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'c', target: 'a' },
    { source: 'd', target: 'e' },
  ];

  it('finds both ends, because straightening is symmetric', () => {
    expect([...neighboursOf('a', edges)].sort()).toEqual(['b', 'c']);
  });

  it('is empty for a node with no arrows', () => {
    expect(neighboursOf('z', edges).size).toBe(0);
  });
});

describe('draggedNode', () => {
  const drag = (id: string, x: number, y: number) => ({
    type: 'position',
    id,
    dragging: true,
    position: { x, y },
  });

  it('finds the node a single drag is moving', () => {
    expect(draggedNode([{ type: 'select', id: 'z' }, drag('a', 10, 20)])).toEqual({
      id: 'a',
      x: 10,
      y: 20,
    });
  });

  it('declines a selection drag, which must keep its internal spacing', () => {
    expect(draggedNode([drag('a', 10, 20), drag('b', 30, 40)])).toBeNull();
  });

  it('ignores the drag-stop frame and anything that is not a move', () => {
    expect(draggedNode([{ type: 'position', id: 'a', dragging: false, position: { x: 1, y: 2 } }])).toBeNull();
    expect(draggedNode([{ type: 'dimensions', id: 'a' }])).toBeNull();
    expect(draggedNode([])).toBeNull();
  });
});

describe('inView', () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 };

  it('keeps a neighbour the camera is showing', () => {
    expect(inView(rect('a', 400, 300), view)).toBe(true);
  });

  it('keeps one that is only half on screen', () => {
    expect(inView(rect('a', -100, 300), view)).toBe(true);
  });

  it('drops one off the edge, guide and all', () => {
    // Its left edge is level with a card on screen, so without this it would
    // tug the drag four pixels sideways and draw a line off into the dark.
    expect(inView(rect('a', 400, 4000), view)).toBe(false);
    expect(inView(rect('a', -400, 300), view)).toBe(false);
  });
});

describe('stepFrom', () => {
  it('leaves a node that started on the grid where React Flow put it', () => {
    expect(stepFrom(104, 104, 8)).toBe(104);
    expect(stepFrom(112, 104, 8)).toBe(112);
  });

  it('gives back the offset the absolute grid threw away', () => {
    // A card alignment left at 103: React Flow offers 104, and without this the
    // card has moved a pixel for a drag that went nowhere.
    expect(stepFrom(104, 103, 8)).toBe(103);
    expect(stepFrom(112, 103, 8)).toBe(111);
    expect(stepFrom(96, 103, 8)).toBe(95);
  });

  it('holds the step exactly on a half-step origin, which rounds either way', () => {
    // 4 is four from both 0 and 8. Deriving the step count by rounding twice
    // sends the node eight pixels away from a pointer that barely moved.
    expect(stepFrom(8, 4, 8)).toBe(4);
    expect(stepFrom(0, 4, 8)).toBe(-4);
    expect(stepFrom(104, 100, 8)).toBe(100);
  });

  it('is the identity with no grid to speak of', () => {
    expect(stepFrom(103.5, 100, 0)).toBe(103.5);
  });
});

describe('isSettling', () => {
  const settle = { type: 'position', id: 'a', dragging: false, position: { x: 1, y: 2 } };

  it('finds the frame React Flow sends as the button comes up', () => {
    expect(isSettling(settle, 'a')).toBe(true);
  });

  it('is not the drag itself, which alignment has already answered', () => {
    expect(isSettling({ ...settle, dragging: true }, 'a')).toBe(false);
  });

  it('leaves every other node and every other kind of change alone', () => {
    expect(isSettling(settle, 'b')).toBe(false);
    expect(isSettling({ type: 'select', id: 'a' }, 'a')).toBe(false);
    expect(isSettling({ type: 'position', id: 'a', dragging: false }, 'a')).toBe(false);
  });
});
