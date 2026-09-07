import type { Id } from '@/domain/board';

/**
 * Alignment snapping while dragging.
 *
 * The 8 px grid alone cannot keep an arrow straight. A handle sits at the
 * midpoint of a node's side, so a horizontal arrow is straight only when the
 * two nodes' vertical centres match — and two nodes of different heights (a
 * 140 px card and a 100 px shape) never share a centre just because both
 * corners landed on the grid. Nudging a card therefore bent its arrows with no
 * way to put it back by eye.
 *
 * So the drag snaps to the things that actually matter: the edges and centres
 * of the nodes already on the board. A node connected to the one being dragged
 * gets a wider catch, because straightening that arrow is usually the whole
 * point of the nudge.
 *
 * Everything here is pure. The canvas feeds it rectangles and applies the
 * result; nothing in this file knows about React or React Flow.
 */

export interface Rect {
  readonly id: Id;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A line the drag snapped to, in flow coordinates, for drawing. */
export interface Guide {
  /** 'x' is a vertical line at that x; 'y' is a horizontal line at that y. */
  readonly axis: 'x' | 'y';
  readonly at: number;
  /** The span to draw over: both rectangles' extent on the other axis. */
  readonly from: number;
  readonly to: number;
}

export interface AlignResult {
  readonly x: number;
  readonly y: number;
  readonly guides: readonly Guide[];
}

/** The camera's window onto the board, in flow coordinates. */
export interface Viewbox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AlignOptions {
  /** Catch distance in flow units for an unconnected node. */
  readonly threshold: number;
  /** Nodes joined to the dragged one by an edge. */
  readonly connected?: ReadonlySet<Id>;
  /** Catch distance for those, normally wider. Defaults to `threshold`. */
  readonly connectedThreshold?: number;
}

/** The three lines a rectangle offers on each axis: near edge, centre, far edge. */
const linesX = (r: Rect): readonly number[] => [r.x, r.x + r.w / 2, r.x + r.w];
const linesY = (r: Rect): readonly number[] => [r.y, r.y + r.h / 2, r.y + r.h];

interface Candidate {
  readonly delta: number;
  readonly at: number;
  readonly other: Rect;
}

/**
 * The smallest move on one axis that puts one of `moving`'s lines onto one of
 * a neighbour's. Ties go to the first neighbour considered, which is why the
 * caller sorts connected nodes to the front.
 */
function bestOnAxis(
  movingLines: readonly number[],
  others: readonly Rect[],
  linesOf: (r: Rect) => readonly number[],
  reach: (other: Rect) => number,
): Candidate | null {
  let best: Candidate | null = null;

  for (const other of others) {
    const limit = reach(other);
    if (limit <= 0) continue;

    for (const target of linesOf(other)) {
      for (const line of movingLines) {
        const delta = target - line;
        if (Math.abs(delta) > limit) continue;
        if (best !== null && Math.abs(delta) >= Math.abs(best.delta)) continue;
        best = { delta, at: target, other };
      }
    }
  }

  return best;
}

/**
 * Snap a dragged rectangle to its neighbours' edges and centres.
 *
 * Returns the position to use and the guides to draw. When nothing is within
 * reach the position comes back unchanged and the guide list is empty, so the
 * caller can apply the result unconditionally.
 */
export function snapToNeighbours(
  moving: Rect,
  others: readonly Rect[],
  options: AlignOptions,
): AlignResult {
  const connected = options.connected ?? new Set<Id>();
  const wide = options.connectedThreshold ?? options.threshold;
  const reach = (other: Rect): number => (connected.has(other.id) ? wide : options.threshold);

  // A connected neighbour wins a tie, so an arrow straightens in preference to
  // lining up with whatever else happens to be the same distance away.
  const ordered =
    connected.size === 0
      ? others
      : [...others].sort(
          (a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)),
        );

  // A connected neighbour is looked at on its centre line alone, and first.
  // Handles sit at the midpoint of a side, so centre-to-centre is the only
  // alignment that actually straightens an arrow: lining a card's bottom up
  // with a shape's bottom leaves the arrow just as bent as it was. The general
  // pass below still offers that neighbour its edges at the ordinary distance.
  const wired = connected.size === 0 ? [] : ordered.filter((r) => connected.has(r.id));
  const centreReach = (): number => wide;

  const x =
    bestOnAxis([moving.x + moving.w / 2], wired, (r) => [r.x + r.w / 2], centreReach) ??
    bestOnAxis(linesX(moving), ordered, linesX, reach);
  const y =
    bestOnAxis([moving.y + moving.h / 2], wired, (r) => [r.y + r.h / 2], centreReach) ??
    bestOnAxis(linesY(moving), ordered, linesY, reach);

  const guides: Guide[] = [];
  const nextX = x === null ? moving.x : moving.x + x.delta;
  const nextY = y === null ? moving.y : moving.y + y.delta;

  if (x !== null) {
    // The vertical guide spans both rectangles top to bottom.
    guides.push({
      axis: 'x',
      at: x.at,
      from: Math.min(nextY, x.other.y),
      to: Math.max(nextY + moving.h, x.other.y + x.other.h),
    });
  }
  if (y !== null) {
    guides.push({
      axis: 'y',
      at: y.at,
      from: Math.min(nextX, y.other.x),
      to: Math.max(nextX + moving.w, y.other.x + y.other.w),
    });
  }

  return { x: nextX, y: nextY, guides };
}

/**
 * Whether a rectangle is on screen.
 *
 * An alignment the eye cannot check is not an alignment. On a board of any size
 * some node is nearly always a few pixels from a line, so without this the drag
 * is tugged about by neighbours that are not being looked at, and the guide
 * that explains it runs off the edge of the screen into the dark. The caller
 * keeps the connected nodes whatever the camera is showing: their arrow is the
 * feedback there, and straightening it is the whole point of the gesture.
 */
export function inView(rect: Rect, view: Viewbox): boolean {
  return (
    rect.x < view.x + view.w &&
    view.x < rect.x + rect.w &&
    rect.y < view.y + view.h &&
    view.y < rect.y + rect.h
  );
}

/**
 * The nodes joined to `id` by an edge, in either direction. Straightening an
 * arrow is symmetric — it does not matter which end is being dragged.
 */
export function neighboursOf(
  id: Id,
  edges: readonly { source: Id; target: Id }[],
): ReadonlySet<Id> {
  const found = new Set<Id>();
  for (const edge of edges) {
    if (edge.source === id) found.add(edge.target);
    else if (edge.target === id) found.add(edge.source);
  }
  return found;
}

/**
 * The part of a React Flow node change this module reads, described
 * structurally so the pure logic stays free of the library's types.
 */
export interface PositionChange {
  readonly type: string;
  readonly id?: string;
  readonly dragging?: boolean;
  readonly position?: { readonly x: number; readonly y: number };
}

/**
 * A grid-snapped position, put back on the grid that runs through `origin`.
 *
 * React Flow snaps a drag to the absolute grid, which throws away whatever
 * offset the node already had. A card alignment left at 103 is pulled to 104 by
 * the first pointer move; drag it eight across and eight back and it has
 * quietly moved a pixel, and an undo entry says so. Off-grid is where alignment
 * puts things — a centre line is not a multiple of eight — so the absolute grid
 * spends its time undoing the snap that matters.
 *
 * The step stays eight; it is just measured from where the node started. A drag
 * that returns is then a drag that changed nothing, and alignment owns the
 * fine position it was written to own.
 */
export function stepFrom(value: number, origin: number, step: number): number {
  if (!(step > 0)) return value;
  return value + origin - Math.round(origin / step) * step;
}

/**
 * True when this change is the frame React Flow sends as a drag is released.
 *
 * React Flow works out a drag position itself, from the pointer and the grid,
 * and sends that figure once more with `dragging` off when the button comes up.
 * That last frame does not pass through `draggedNode`, so unless the caller
 * puts the aligned position back into it the node hops off the guide it was
 * sitting on at the exact moment it is let go — and whatever reads the same
 * frame to write the document writes the hop with it. A snap has to survive
 * the release to have happened at all.
 */
export function isSettling(change: PositionChange, id: Id): boolean {
  return (
    change.type === 'position' &&
    change.id === id &&
    change.dragging !== true &&
    change.position !== undefined
  );
}

/**
 * The one node a drag is moving, or null.
 *
 * Alignment applies to a single-node drag only. Moving a selection keeps the
 * plain grid: snapping a group of nodes to a neighbour would silently change
 * their spacing relative to each other, which is worse than the bent arrow it
 * set out to fix.
 */
export function draggedNode(
  changes: readonly PositionChange[],
): { id: Id; x: number; y: number } | null {
  let found: { id: Id; x: number; y: number } | null = null;

  for (const change of changes) {
    if (change.type !== 'position' || change.dragging !== true) continue;
    if (change.id === undefined || change.position === undefined) continue;
    if (found !== null) return null; // more than one: a selection is moving
    found = { id: change.id, x: change.position.x, y: change.position.y };
  }

  return found;
}
