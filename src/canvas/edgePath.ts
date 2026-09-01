import type { Handle } from '@/domain/board';

/**
 * Edge geometry through user-placed waypoints.
 *
 * React Flow's own path helpers route between two handles and know nothing
 * about points in between, so an edge the user has bent needs its own path.
 * Everything here is pure arithmetic: the edge component feeds it endpoints and
 * waypoints and draws what comes back.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How far an orthogonal route leaves a handle before it is allowed to turn. */
export const STUB = 20;

const isVertical = (side: Handle): boolean => side === 'top' || side === 'bottom';

/** The point an orthogonal route reaches before it may turn away from a handle. */
export function stubFrom(at: Point, side: Handle, distance = STUB): Point {
  switch (side) {
    case 'top':
      return { x: at.x, y: at.y - distance };
    case 'bottom':
      return { x: at.x, y: at.y + distance };
    case 'left':
      return { x: at.x - distance, y: at.y };
    default:
      return { x: at.x + distance, y: at.y };
  }
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
const samePoint = (a: Point, b: Point): boolean => near(a.x, b.x) && near(a.y, b.y);

/**
 * Insert a corner between any two points that are not already on a shared axis,
 * so the finished list is a staircase.
 *
 * Which way the corner turns is decided by the segment before it: a route that
 * arrived travelling horizontally continues horizontally, then turns. That is
 * what keeps a bent edge from doubling back on itself at every waypoint.
 */
export function orthogonalise(points: readonly Point[], startVertical: boolean): Point[] {
  const out: Point[] = [];
  let vertical = startVertical;

  for (const point of points) {
    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(point);
      continue;
    }
    if (samePoint(last, point)) continue;

    const aligned = near(last.x, point.x) || near(last.y, point.y);
    if (aligned) {
      // The segment itself tells us which way the next corner should turn.
      vertical = near(last.x, point.x);
      out.push(point);
      continue;
    }

    out.push(vertical ? { x: last.x, y: point.y } : { x: point.x, y: last.y });
    out.push(point);
    vertical = !vertical;
  }

  return out;
}

/**
 * Drop a point that sits on the straight line between its neighbours.
 *
 * `keep` protects the user's own waypoints. A waypoint dragged into line with
 * its neighbours is geometrically redundant, but it is still a thing the user
 * placed and can grab again — silently dissolving it the moment it straightens
 * would make a bent edge impossible to unbend by hand.
 */
export function simplify(points: readonly Point[], keep?: (point: Point) => boolean): Point[] {
  const out: Point[] = [];

  for (const point of points) {
    const last = out[out.length - 1];
    if (last !== undefined && samePoint(last, point)) continue;

    const before = out[out.length - 2];
    if (before !== undefined && last !== undefined && (keep === undefined || !keep(last))) {
      const straightX = near(before.x, last.x) && near(last.x, point.x);
      const straightY = near(before.y, last.y) && near(last.y, point.y);
      if (straightX || straightY) out.pop();
    }
    out.push(point);
  }

  return out;
}

/**
 * An SVG path through the points, with the corners rounded.
 *
 * The radius shrinks to fit whichever of the two meeting segments is shorter,
 * so a tight elbow stays a corner instead of collapsing into a loop.
 */
export function roundedPath(points: readonly Point[], radius: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (first === undefined) return '';
  if (points.length === 1) return `M ${first.x},${first.y}`;

  let d = `M ${first.x},${first.y}`;

  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    if (previous === undefined || corner === undefined || next === undefined) continue;

    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);

    if (r < 0.5) {
      d += ` L ${corner.x},${corner.y}`;
      continue;
    }

    const enter = {
      x: corner.x + ((previous.x - corner.x) / inLength) * r,
      y: corner.y + ((previous.y - corner.y) / inLength) * r,
    };
    const leave = {
      x: corner.x + ((next.x - corner.x) / outLength) * r,
      y: corner.y + ((next.y - corner.y) / outLength) * r,
    };

    d += ` L ${enter.x},${enter.y} Q ${corner.x},${corner.y} ${leave.x},${leave.y}`;
  }

  const last = points[points.length - 1];
  if (last !== undefined) d += ` L ${last.x},${last.y}`;
  return d;
}

export interface WaypointRoute {
  readonly source: Point;
  readonly target: Point;
  readonly sourceSide: Handle;
  readonly targetSide: Handle;
  readonly waypoints: readonly Point[];
  readonly stepped: boolean;
  readonly radius?: number;
}

/**
 * The full point list for an edge the user has bent, and the path for it.
 *
 * A stepped edge leaves each handle along its own axis before it is allowed to
 * turn, which is what stops an arrow emerging sideways out of the face of a
 * card. A straight one simply joins the dots.
 */
export function routeThrough(route: WaypointRoute): { points: Point[]; path: string } {
  const { source, target, sourceSide, targetSide, waypoints } = route;

  const isWaypoint = (point: Point): boolean => waypoints.some((w) => samePoint(w, point));

  if (!route.stepped) {
    const points = simplify([source, ...waypoints, target], isWaypoint);
    return { points, path: roundedPath(points, 0) };
  }

  const raw = [
    source,
    stubFrom(source, sourceSide),
    ...waypoints,
    stubFrom(target, targetSide),
    target,
  ];

  // The first segment runs along the source handle's own axis.
  const points = simplify(orthogonalise(raw, isVertical(sourceSide)), isWaypoint);
  return { points, path: roundedPath(points, route.radius ?? 8) };
}

/** The midpoint of every segment — where a drag creates a new waypoint. */
export function segmentMidpoints(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    if (samePoint(a, b)) continue;
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

/**
 * Where a new waypoint belongs in the list, given the segment it was pulled
 * from. The handle stubs are part of the drawn route but not of the stored
 * waypoints, so the index has to be mapped back across them.
 */
export function insertionIndex(
  segment: number,
  points: readonly Point[],
  waypoints: readonly Point[],
): number {
  if (waypoints.length === 0) return 0;

  // Count how many stored waypoints appear at or before the segment's start.
  let seen = 0;
  for (let i = 0; i <= segment && i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    if (waypoints.some((w) => samePoint(w, point))) seen += 1;
  }
  return Math.min(seen, waypoints.length);
}
