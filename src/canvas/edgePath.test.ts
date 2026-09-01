import { describe, expect, it } from 'vitest';
import {
  insertionIndex,
  orthogonalise,
  roundedPath,
  routeThrough,
  segmentMidpoints,
  simplify,
  stubFrom,
  type Point,
} from '@/canvas/edgePath';

const p = (x: number, y: number): Point => ({ x, y });

/** Every corner in an orthogonal route must share an axis with the last point. */
const isStaircase = (points: readonly Point[]): boolean =>
  points.every((point, i) => {
    if (i === 0) return true;
    const last = points[i - 1];
    return last !== undefined && (Math.abs(last.x - point.x) < 0.5 || Math.abs(last.y - point.y) < 0.5);
  });

describe('stubFrom', () => {
  it('leaves a handle along its own axis', () => {
    expect(stubFrom(p(100, 100), 'right', 20)).toEqual(p(120, 100));
    expect(stubFrom(p(100, 100), 'left', 20)).toEqual(p(80, 100));
    expect(stubFrom(p(100, 100), 'top', 20)).toEqual(p(100, 80));
    expect(stubFrom(p(100, 100), 'bottom', 20)).toEqual(p(100, 120));
  });
});

describe('orthogonalise', () => {
  it('turns a diagonal into a staircase', () => {
    const out = orthogonalise([p(0, 0), p(100, 50)], false);
    expect(isStaircase(out)).toBe(true);
    expect(out[out.length - 1]).toEqual(p(100, 50));
  });

  it('turns the first corner the way the start says', () => {
    expect(orthogonalise([p(0, 0), p(100, 50)], false)[1]).toEqual(p(100, 0));
    expect(orthogonalise([p(0, 0), p(100, 50)], true)[1]).toEqual(p(0, 50));
  });

  it('leaves points that already share an axis alone', () => {
    expect(orthogonalise([p(0, 0), p(100, 0), p(100, 80)], false)).toEqual([
      p(0, 0),
      p(100, 0),
      p(100, 80),
    ]);
  });

  it('stays a staircase across several waypoints', () => {
    const out = orthogonalise([p(0, 0), p(60, 40), p(20, 120), p(200, 90)], false);
    expect(isStaircase(out)).toBe(true);
  });

  it('drops a repeated point instead of emitting a zero-length segment', () => {
    expect(orthogonalise([p(10, 10), p(10, 10), p(10, 60)], true)).toEqual([p(10, 10), p(10, 60)]);
  });
});

describe('simplify', () => {
  it('keeps a point the caller protects, even when it is redundant', () => {
    const keep = (q: Point): boolean => q.x === 50 && q.y === 0;
    expect(simplify([p(0, 0), p(50, 0), p(100, 0)], keep)).toHaveLength(3);
  });

  it('drops a point sitting on the line between its neighbours', () => {
    expect(simplify([p(0, 0), p(50, 0), p(100, 0)])).toEqual([p(0, 0), p(100, 0)]);
    expect(simplify([p(0, 0), p(0, 50), p(0, 100)])).toEqual([p(0, 0), p(0, 100)]);
  });

  it('keeps a real corner', () => {
    expect(simplify([p(0, 0), p(100, 0), p(100, 50)])).toHaveLength(3);
  });
});

describe('roundedPath', () => {
  it('is empty for no points and a move for one', () => {
    expect(roundedPath([], 8)).toBe('');
    expect(roundedPath([p(3, 4)], 8)).toBe('M 3,4');
  });

  it('rounds a corner with a quadratic', () => {
    const d = roundedPath([p(0, 0), p(100, 0), p(100, 100)], 8);
    expect(d.startsWith('M 0,0')).toBe(true);
    expect(d).toContain('Q 100,0');
    expect(d.trim().endsWith('L 100,100')).toBe(true);
  });

  it('shrinks the radius rather than overrunning a short segment', () => {
    // Segments of 4, so a radius of 8 would run past the corner on both sides.
    const d = roundedPath([p(0, 0), p(4, 0), p(4, 4)], 8);
    expect(d).toContain('Q 4,0');
    expect(d).not.toContain('NaN');
    for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) expect(Number.isFinite(Number(n))).toBe(true);
  });
});

describe('routeThrough', () => {
  const base = {
    source: p(0, 0),
    target: p(300, 200),
    sourceSide: 'right' as const,
    targetSide: 'left' as const,
  };

  it('leaves both handles along their own axis', () => {
    const { points } = routeThrough({ ...base, waypoints: [], stepped: true });

    // The stub itself is collinear with the first segment and gets simplified
    // away, so assert the property rather than the point: the route leaves a
    // right-hand handle going sideways, and enters a left-hand one the same way.
    const first = points[1];
    const last = points[points.length - 2];
    expect(first?.y).toBe(base.source.y);
    expect(first?.x).toBeGreaterThan(base.source.x);
    expect(last?.y).toBe(base.target.y);
    expect(last?.x).toBeLessThan(base.target.x);
  });

  it('passes through every waypoint, still as a staircase', () => {
    const waypoints = [p(150, 60), p(120, 160)];
    const { points } = routeThrough({ ...base, waypoints, stepped: true });

    expect(isStaircase(points)).toBe(true);
    for (const w of waypoints) {
      expect(points.some((q) => q.x === w.x && q.y === w.y)).toBe(true);
    }
  });

  it('joins the dots when the edge is not stepped', () => {
    const { points } = routeThrough({ ...base, waypoints: [p(150, 60)], stepped: false });
    expect(points).toEqual([p(0, 0), p(150, 60), p(300, 200)]);
  });

  it('produces a finite path in every case', () => {
    for (const stepped of [true, false]) {
      for (const waypoints of [[], [p(10, 10)], [p(0, 0), p(300, 200)]]) {
        const { path } = routeThrough({ ...base, waypoints, stepped });
        expect(path).not.toContain('NaN');
        expect(path).not.toContain('Infinity');
      }
    }
  });

  it('survives a waypoint sitting exactly on an endpoint', () => {
    const { points, path } = routeThrough({ ...base, waypoints: [p(0, 0)], stepped: true });
    expect(isStaircase(points)).toBe(true);
    expect(path).not.toContain('NaN');
  });
});

describe('segmentMidpoints', () => {
  it('gives one per segment', () => {
    expect(segmentMidpoints([p(0, 0), p(100, 0), p(100, 100)])).toEqual([p(50, 0), p(100, 50)]);
  });

  it('skips a zero-length segment, which has no midpoint to grab', () => {
    expect(segmentMidpoints([p(0, 0), p(0, 0), p(0, 100)])).toEqual([p(0, 50)]);
  });
});

describe('insertionIndex', () => {
  it('puts the first waypoint at the front', () => {
    expect(insertionIndex(0, [p(0, 0), p(100, 0)], [])).toBe(0);
  });

  it('places a new point after the stored waypoints already passed', () => {
    const stored = [p(50, 0), p(50, 90)];
    const points = [p(0, 0), p(50, 0), p(50, 90), p(120, 90)];
    expect(insertionIndex(0, points, stored)).toBe(0);
    expect(insertionIndex(2, points, stored)).toBe(2);
  });

  it('never points past the end of the list', () => {
    expect(insertionIndex(99, [p(0, 0), p(1, 1)], [p(0, 0)])).toBeLessThanOrEqual(1);
  });
});
