import { describe, expect, it } from 'vitest';
import type { BoardDoc, BoardNode } from '@/domain/board';
import {
  makeBoard,
  makeBoardLink,
  makeCard,
  makeEdge,
  makeGroup,
  makeNote,
  makeShape,
} from '@/state/factories';
import {
  CONNECT_GAP,
  PERIMETER_HANDLE,
  canConnect,
  choiceSize,
  connectRefusal,
  containsPoint,
  echoChoice,
  hasEdgeBetween,
  isConnectableNode,
  makeIsValidConnection,
  nodeAtPoint,
  nodeForChoice,
  nodeRect,
  placeBeside,
  placeConnected,
  planDrop,
  planStubClick,
  rectsOverlap,
  resolveSides,
  sideAnchor,
  sideFacing,
  sideFromHandleId,
  topLeftAround,
  type Rect,
} from '@/canvas/connect';

const CARD: Rect = { x: 0, y: 0, w: 240, h: 140 };

function board(nodes: BoardNode[] = []): BoardDoc {
  const doc = makeBoard({ title: 'Board', ownerId: 'u', statuses: [] });
  doc.nodes = nodes;
  doc.edges = [];
  return doc;
}

describe('rectangles', () => {
  it('anchors each side at its midpoint', () => {
    expect(sideAnchor(CARD, 'top')).toEqual({ x: 120, y: 0 });
    expect(sideAnchor(CARD, 'bottom')).toEqual({ x: 120, y: 140 });
    expect(sideAnchor(CARD, 'left')).toEqual({ x: 0, y: 70 });
    expect(sideAnchor(CARD, 'right')).toEqual({ x: 240, y: 70 });
  });

  it('reads a node as the rectangle it occupies', () => {
    const card = makeCard({ position: { x: 12, y: -4 }, size: { w: 100, h: 50 } });
    expect(nodeRect(card)).toEqual({ x: 12, y: -4, w: 100, h: 50 });
  });

  it('counts the border as inside, and honours a pad', () => {
    expect(containsPoint(CARD, { x: 0, y: 0 })).toBe(true);
    expect(containsPoint(CARD, { x: 240, y: 140 })).toBe(true);
    expect(containsPoint(CARD, { x: 246, y: 70 })).toBe(false);
    expect(containsPoint(CARD, { x: 246, y: 70 }, 8)).toBe(true);
  });

  it('detects overlap without counting a shared edge', () => {
    expect(rectsOverlap(CARD, { x: 240, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap(CARD, { x: 239, y: 0, w: 10, h: 10 })).toBe(true);
  });
});

describe('sideFacing', () => {
  it('picks the side the point lies off', () => {
    expect(sideFacing(CARD, { x: 400, y: 70 })).toBe('right');
    expect(sideFacing(CARD, { x: -400, y: 70 })).toBe('left');
    expect(sideFacing(CARD, { x: 120, y: -200 })).toBe('top');
    expect(sideFacing(CARD, { x: 120, y: 400 })).toBe('bottom');
  });

  it('measures each offset against its own half-extent, so a wide node still has a top', () => {
    const banner: Rect = { x: 0, y: 0, w: 400, h: 60 };
    // 100 px up and 150 px across: further sideways, but far more of the way
    // out of a 60 px-tall box than of a 400 px-wide one.
    expect(sideFacing(banner, { x: 350, y: -70 })).toBe('top');
    // Raw distance would answer 'right' for both.
    expect(sideFacing(banner, { x: 620, y: 20 })).toBe('right');
  });

  it('answers the same way every time for a point on the centre', () => {
    expect(sideFacing(CARD, { x: 120, y: 70 })).toBe('right');
  });
});

describe('sideFromHandleId', () => {
  it('recognises the four sides and nothing else', () => {
    expect(sideFromHandleId('top')).toBe('top');
    expect(sideFromHandleId('left')).toBe('left');
    expect(sideFromHandleId(PERIMETER_HANDLE)).toBeNull();
    expect(sideFromHandleId(null)).toBeNull();
    expect(sideFromHandleId(undefined)).toBeNull();
  });
});

describe('resolveSides', () => {
  const target: Rect = { x: 600, y: 0, w: 240, h: 140 };

  it('takes the target side from the drag while the pointer is still outside it', () => {
    // Coming in high above the target: it should attach to the top.
    expect(resolveSides(CARD, target, { x: 720, y: -180 })).toEqual({
      sourceHandle: 'right',
      targetHandle: 'top',
    });
  });

  it('hands over to the source once the pointer is inside the target', () => {
    // The pointer sits in the target's right half, but the arrow arrives from
    // the left, and that is what the picture has to read as.
    expect(resolveSides(CARD, target, { x: 800, y: 70 })).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    });
  });

  it('keeps the source side a stub drag fixed', () => {
    expect(resolveSides(CARD, target, { x: 700, y: 70 }, 'bottom')).toEqual({
      sourceHandle: 'bottom',
      targetHandle: 'left',
    });
  });

  it('turns the source to face the side it picked when the drag came off the perimeter', () => {
    const below: Rect = { x: 0, y: 400, w: 240, h: 140 };
    expect(resolveSides(CARD, below, { x: 120, y: 460 })).toEqual({
      sourceHandle: 'bottom',
      targetHandle: 'top',
    });
  });
});

describe('nodeAtPoint', () => {
  it('returns the node the point is inside', () => {
    const a = makeCard({ id: 'a', position: { x: 0, y: 0 } });
    const b = makeCard({ id: 'b', position: { x: 400, y: 0 } });
    expect(nodeAtPoint([a, b], { x: 420, y: 20 })?.id).toBe('b');
    expect(nodeAtPoint([a, b], { x: 320, y: 20 })).toBeNull();
  });

  it('prefers the node painted last', () => {
    const under = makeCard({ id: 'under', position: { x: 0, y: 0 }, z: 0 });
    const over = makeCard({ id: 'over', position: { x: 20, y: 20 }, z: 5 });
    expect(nodeAtPoint([over, under], { x: 40, y: 40 })?.id).toBe('over');
  });

  it('never answers with a frame', () => {
    const frame = makeGroup({ id: 'g', position: { x: 0, y: 0 }, size: { w: 800, h: 600 } });
    expect(isConnectableNode(frame)).toBe(false);
    expect(nodeAtPoint([frame], { x: 100, y: 100 })).toBeNull();
  });
});

describe('connectRefusal', () => {
  const open = { id: 'a', locked: false };
  const other = { id: 'b', locked: false };

  it('accepts two different unlocked nodes with nothing between them', () => {
    expect(connectRefusal(open, other, [])).toBeNull();
    expect(canConnect(open, other, [])).toBe(true);
  });

  it('refuses a node connected to itself', () => {
    expect(connectRefusal(open, { id: 'a', locked: false }, [])).toBe('self');
  });

  it('refuses a locked node at either end', () => {
    expect(connectRefusal({ id: 'a', locked: true }, other, [])).toBe('locked');
    expect(connectRefusal(open, { id: 'b', locked: true }, [])).toBe('locked');
  });

  it('refuses a second arrow the same way round, and allows the way back', () => {
    const edges = [{ source: 'a', target: 'b' }];
    expect(hasEdgeBetween(edges, 'a', 'b')).toBe(true);
    expect(hasEdgeBetween(edges, 'b', 'a')).toBe(false);
    expect(connectRefusal(open, other, edges)).toBe('duplicate');
    expect(connectRefusal(other, open, edges)).toBeNull();
  });
});

describe('makeIsValidConnection', () => {
  const a = makeCard({ id: 'a', position: { x: 0, y: 0 } });
  const b = makeCard({ id: 'b', position: { x: 400, y: 0 } });
  const frame = makeGroup({ id: 'g', position: { x: 0, y: 0 } });
  const doc = board([a, b, frame]);
  doc.edges = [makeEdge({ source: 'a', target: 'b' })];
  const isValid = makeIsValidConnection(() => doc);

  it('accepts an arrow that does not exist yet', () => {
    expect(isValid({ source: 'b', target: 'a' })).toBe(true);
  });

  it('refuses a duplicate, a frame, a stranger and a missing document', () => {
    expect(isValid({ source: 'a', target: 'b' })).toBe(false);
    expect(isValid({ source: 'a', target: 'g' })).toBe(false);
    expect(isValid({ source: 'a', target: 'nobody' })).toBe(false);
    expect(isValid({ source: null, target: 'b' })).toBe(false);
    expect(makeIsValidConnection(() => null)({ source: 'a', target: 'b' })).toBe(false);
  });
});

describe('placeBeside', () => {
  const size = { w: 240, h: 140 };

  it('centres the new node on the side it hangs off, one gap clear', () => {
    expect(placeBeside(CARD, 'right', size)).toEqual({ x: 240 + CONNECT_GAP, y: 0 });
    expect(placeBeside(CARD, 'left', size)).toEqual({ x: -(240 + CONNECT_GAP), y: 0 });
  });

  it('lands on the 8 px lattice a dragged node lands on', () => {
    expect(placeBeside(CARD, 'bottom', size)).toEqual({ x: 0, y: 200 });
    expect(placeBeside(CARD, 'top', size)).toEqual({ x: 0, y: -192 });
  });
});

describe('placeConnected', () => {
  it('walks further out rather than burying an existing node', () => {
    const from = makeCard({ id: 'from', position: { x: 0, y: 0 } });
    const blocker = makeCard({ id: 'blocker', position: { x: 296, y: 0 } });
    const size = { w: 240, h: 140 };
    expect(placeConnected([from, blocker], nodeRect(from), 'right', size)).toEqual({ x: 592, y: 0 });
  });

  it('ignores frames, so a node may be created inside one', () => {
    const from = makeCard({ id: 'from', position: { x: 0, y: 0 } });
    const frame = makeGroup({ id: 'g', position: { x: -100, y: -100 }, size: { w: 900, h: 500 } });
    expect(placeConnected([from, frame], nodeRect(from), 'right', { w: 240, h: 140 })).toEqual({
      x: 296,
      y: 0,
    });
  });
});

describe('topLeftAround', () => {
  it('centres a box on a point', () => {
    expect(topLeftAround({ x: 100, y: 50 }, { w: 240, h: 140 })).toEqual({ x: -20, y: -20 });
  });
});

describe('choices', () => {
  it('echoes the kind it came from where a blank one means something', () => {
    expect(echoChoice(makeCard({ position: { x: 0, y: 0 } }))).toEqual({ kind: 'card' });
    expect(echoChoice(makeNote({ position: { x: 0, y: 0 } }))).toEqual({ kind: 'note' });
    expect(echoChoice(makeShape({ position: { x: 0, y: 0 }, shape: 'hexagon' }))).toEqual({
      kind: 'shape',
      shape: 'hexagon',
    });
  });

  it('answers with a card for the kinds that cannot be conjured empty', () => {
    const link = makeBoardLink({ position: { x: 0, y: 0 }, targetBoardId: 'other' });
    expect(echoChoice(link)).toEqual({ kind: 'card' });
  });

  it('sizes a choice from the node defaults', () => {
    expect(choiceSize({ kind: 'card' })).toEqual({ w: 240, h: 140 });
    expect(choiceSize({ kind: 'shape', shape: 'ellipse' })).toEqual({ w: 160, h: 100 });
  });

  it('builds the node the choice names at a whole-pixel position', () => {
    const doc = board([makeCard({ id: 'a', position: { x: 0, y: 0 } })]);
    const made = nodeForChoice(doc, { kind: 'shape', shape: 'diamond' }, { x: 10.4, y: -3.6 }, 'u');
    expect(made.kind).toBe('shape');
    expect(made.position).toEqual({ x: 10, y: -4 });
    expect(made.updatedBy).toBe('u');

    const card = nodeForChoice(doc, { kind: 'card' }, { x: 0, y: 0 }, 'u');
    expect(card.kind === 'card' && card.rank.length > 0).toBe(true);
  });
});

describe('planStubClick', () => {
  it('places the echo one step out and points the arrow straight at it', () => {
    const from = makeNote({ id: 'n', position: { x: 0, y: 0 }, size: { w: 200, h: 160 } });
    const doc = board([from]);
    const plan = planStubClick(doc, from, 'right');
    expect(plan.choice).toEqual({ kind: 'note' });
    expect(plan.position).toEqual({ x: 256, y: 0 });
    expect(plan.sides).toEqual({ sourceHandle: 'right', targetHandle: 'left' });
  });

  it('keeps the side the stub named even when the echo is shoved past a neighbour', () => {
    const from = makeCard({ id: 'a', position: { x: 0, y: 0 } });
    const blocker = makeCard({ id: 'b', position: { x: 0, y: 196 } });
    const doc = board([from, blocker]);
    const plan = planStubClick(doc, from, 'bottom');
    expect(plan.position.y).toBeGreaterThan(196);
    expect(plan.sides).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' });
  });
});

describe('planDrop', () => {
  const a = makeCard({ id: 'a', position: { x: 0, y: 0 } });
  const b = makeCard({ id: 'b', position: { x: 600, y: 0 } });

  it('connects a drop that lands anywhere on a node, not only on its handles', () => {
    const doc = board([a, b]);
    const plan = planDrop({ doc, fromId: 'a', fromHandleId: PERIMETER_HANDLE, point: { x: 700, y: 120 } });
    expect(plan).toEqual({
      action: 'connect',
      target: b,
      sides: { sourceHandle: 'right', targetHandle: 'left' },
    });
  });

  it('trusts the node React Flow already resolved over its own hit test', () => {
    const doc = board([a, b]);
    const plan = planDrop({
      doc,
      fromId: 'a',
      fromHandleId: 'right',
      point: { x: 900, y: 900 },
      overId: 'b',
    });
    expect(plan.action).toBe('connect');
  });

  it('keeps the side of a stub the drop actually landed on', () => {
    const doc = board([a, b]);
    const plan = planDrop({
      doc,
      fromId: 'a',
      fromHandleId: 'right',
      // React Flow snapped the drop to the target's bottom stub; the geometry
      // on its own would have answered 'left'.
      point: { x: 720, y: 140 },
      overId: 'b',
      overHandleId: 'bottom',
    });
    expect(plan).toEqual({
      action: 'connect',
      target: b,
      sides: { sourceHandle: 'right', targetHandle: 'bottom' },
    });
  });

  it('ignores a perimeter drop as a named side and works the geometry out', () => {
    const doc = board([a, b]);
    const plan = planDrop({
      doc,
      fromId: 'a',
      fromHandleId: PERIMETER_HANDLE,
      point: { x: 720, y: 70 },
      overId: 'b',
      overHandleId: PERIMETER_HANDLE,
    });
    expect(plan).toEqual({
      action: 'connect',
      target: b,
      sides: { sourceHandle: 'right', targetHandle: 'left' },
    });
  });

  it('refuses a duplicate and says which one it is', () => {
    const doc = board([a, b]);
    doc.edges = [makeEdge({ source: 'a', target: 'b' })];
    expect(planDrop({ doc, fromId: 'a', fromHandleId: 'right', point: { x: 700, y: 70 } })).toEqual({
      action: 'refuse',
      target: b,
      refusal: 'duplicate',
    });
  });

  it('refuses a locked target', () => {
    const locked = makeCard({ id: 'b', position: { x: 600, y: 0 }, locked: true });
    const doc = board([a, locked]);
    const plan = planDrop({ doc, fromId: 'a', fromHandleId: 'right', point: { x: 700, y: 70 } });
    expect(plan).toEqual({ action: 'refuse', target: locked, refusal: 'locked' });
  });

  it('asks what to create when the drop lands on empty canvas', () => {
    const doc = board([a, b]);
    expect(planDrop({ doc, fromId: 'a', fromHandleId: PERIMETER_HANDLE, point: { x: 120, y: 400 } })).toEqual(
      { action: 'create', sourceHandle: 'bottom' },
    );
  });

  it('keeps the stub side when the drop lands on empty canvas', () => {
    const doc = board([a, b]);
    expect(planDrop({ doc, fromId: 'a', fromHandleId: 'left', point: { x: 120, y: 400 } })).toEqual({
      action: 'create',
      sourceHandle: 'left',
    });
  });

  it('does nothing when the drag is let go where it started', () => {
    const doc = board([a, b]);
    expect(planDrop({ doc, fromId: 'a', fromHandleId: 'right', point: { x: 120, y: 70 } })).toEqual({
      action: 'none',
    });
    expect(planDrop({ doc, fromId: 'a', fromHandleId: 'right', point: { x: 120, y: 70 }, overId: 'a' })).toEqual(
      { action: 'none' },
    );
  });

  it('does nothing when the source has gone', () => {
    expect(planDrop({ doc: board([b]), fromId: 'a', fromHandleId: null, point: { x: 0, y: 0 } })).toEqual({
      action: 'none',
    });
  });
});
