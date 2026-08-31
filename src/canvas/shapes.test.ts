import { describe, expect, it } from 'vitest';
import { SHAPE_KINDS } from '@/domain/board';
import { SHAPE_GEOMETRY, SHAPE_LABEL, SHAPE_ORDER, drawnSize } from '@/canvas/shapes';

/* ------------------------------------------------------------------ *
 * A minimal SVG path reader — enough to prove the generators emit real
 * path data, and to sample every curve so a shape cannot quietly draw
 * outside the box it was given.
 * ------------------------------------------------------------------ */

interface Pt {
  x: number;
  y: number;
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, A: 7, Z: 0 };

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Endpoint parameterisation → centre parameterisation (SVG spec, F.6.5), rotation 0. */
function ellipticalArc(from: Pt, rx: number, ry: number, large: number, sweep: number, to: Pt): Pt[] {
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  let a = Math.abs(rx);
  let b = Math.abs(ry);
  const lambda = (dx * dx) / (a * a) + (dy * dy) / (b * b);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    a *= s;
    b *= s;
  }
  const denom = a * a * dy * dy + b * b * dx * dx;
  const num = Math.max(0, a * a * b * b - denom);
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(num / denom);
  const cx = factor * ((a * dy) / b) + (from.x + to.x) / 2;
  const cy = factor * ((-b * dx) / a) + (from.y + to.y) / 2;

  const t0 = Math.atan2((from.y - cy) / b, (from.x - cx) / a);
  const t1 = Math.atan2((to.y - cy) / b, (to.x - cx) / a);
  let delta = t1 - t0;
  if (sweep === 1 && delta < 0) delta += Math.PI * 2;
  if (sweep === 0 && delta > 0) delta -= Math.PI * 2;

  const out: Pt[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = t0 + (delta * i) / 32;
    out.push({ x: cx + a * Math.cos(t), y: cy + b * Math.sin(t) });
  }
  return out;
}

interface ParsedPath {
  /** Every point the pen is placed on by a command. */
  anchors: Pt[];
  /** Anchors plus everything the curves pass through. */
  samples: Pt[];
  commands: string[];
}

function parsePath(d: string): ParsedPath {
  const tokens = d.match(/[MLHVCAZ]|-?\d+(?:\.\d+)?/g) ?? [];
  // Nothing in the string may be unreadable: no stray letters, no `NaN`.
  expect(tokens.join('')).toBe(d.replace(/\s+/g, ''));

  const anchors: Pt[] = [];
  const samples: Pt[] = [];
  const commands: string[] = [];
  let at: Pt = { x: 0, y: 0 };
  let sub: Pt = { x: 0, y: 0 };
  let i = 0;
  let command = '';

  const place = (p: Pt): void => {
    at = p;
    anchors.push(p);
    samples.push(p);
  };

  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (token in ARITY) {
      command = token;
      i += 1;
    } else if (command === '') {
      throw new Error(`path starts with a number: ${d}`);
    }
    commands.push(command);

    const arity = ARITY[command] as number;
    const args: number[] = [];
    for (let k = 0; k < arity; k++) {
      const raw = tokens[i + k];
      expect(raw, `missing argument for ${command} in ${d}`).toBeDefined();
      const value = Number(raw);
      expect(Number.isFinite(value), `non-finite argument in ${d}`).toBe(true);
      args.push(value);
    }
    i += arity;

    switch (command) {
      case 'M':
        place({ x: args[0] as number, y: args[1] as number });
        sub = at;
        break;
      case 'L':
        place({ x: args[0] as number, y: args[1] as number });
        break;
      case 'H':
        place({ x: args[0] as number, y: at.y });
        break;
      case 'V':
        place({ x: at.x, y: args[0] as number });
        break;
      case 'C': {
        const end = { x: args[4] as number, y: args[5] as number };
        samples.push(
          ...cubic(at, { x: args[0] as number, y: args[1] as number }, { x: args[2] as number, y: args[3] as number }, end),
        );
        place(end);
        break;
      }
      case 'A': {
        const [rx, ry, rotation, large, sweep] = args as [number, number, number, number, number];
        expect(rx).toBeGreaterThan(0);
        expect(ry).toBeGreaterThan(0);
        expect(rotation).toBe(0);
        expect([0, 1]).toContain(large);
        expect([0, 1]).toContain(sweep);
        const end = { x: args[5] as number, y: args[6] as number };
        samples.push(...ellipticalArc(at, rx, ry, large, sweep, end));
        place(end);
        break;
      }
      default:
        at = sub;
        break;
    }
  }

  return { anchors, samples, commands };
}

const SIZES: ReadonlyArray<[number, number]> = [
  [24, 18], // the palette preview
  [40, 40],
  [160, 100], // the default shape node
  [400, 90], // a wide banner
  [90, 400], // a tall column
  [1000, 640],
];

const EPSILON = 0.05;

describe('SHAPE_GEOMETRY', () => {
  it('covers every shape kind in the domain', () => {
    for (const kind of SHAPE_KINDS) expect(SHAPE_GEOMETRY[kind]).toBeDefined();
    expect(Object.keys(SHAPE_GEOMETRY)).toHaveLength(SHAPE_KINDS.length);
  });

  for (const kind of SHAPE_KINDS) {
    describe(kind, () => {
      it('emits readable path data at every size', () => {
        for (const [w, h] of SIZES) {
          const d = SHAPE_GEOMETRY[kind].path(w, h);
          expect(d.length).toBeGreaterThan(0);
          expect(d).not.toMatch(/NaN|Infinity|undefined/);
          const parsed = parsePath(d);
          expect(parsed.commands[0]).toBe('M');
          expect(parsed.anchors.length).toBeGreaterThan(2);
        }
      });

      it('stays inside the box it is given', () => {
        for (const [w, h] of SIZES) {
          const { samples } = parsePath(SHAPE_GEOMETRY[kind].path(w, h));
          for (const p of samples) {
            expect(p.x).toBeGreaterThanOrEqual(-EPSILON);
            expect(p.y).toBeGreaterThanOrEqual(-EPSILON);
            expect(p.x).toBeLessThanOrEqual(w + EPSILON);
            expect(p.y).toBeLessThanOrEqual(h + EPSILON);
          }
        }
      });

      it('fills the box it is given', () => {
        for (const [w, h] of SIZES) {
          const { samples } = parsePath(SHAPE_GEOMETRY[kind].path(w, h));
          const xs = samples.map((p) => p.x);
          const ys = samples.map((p) => p.y);
          // Every shape reaches all four edges, give or take a rounded corner.
          expect(Math.min(...xs)).toBeLessThanOrEqual(w * 0.03);
          expect(Math.min(...ys)).toBeLessThanOrEqual(h * 0.03);
          expect(Math.max(...xs)).toBeGreaterThanOrEqual(w * 0.97);
          expect(Math.max(...ys)).toBeGreaterThanOrEqual(h * 0.97);
        }
      });

      it('offers a label area inside its own box', () => {
        for (const [w, h] of SIZES) {
          const r = SHAPE_GEOMETRY[kind].labelInset(w, h);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.w).toBeGreaterThanOrEqual(0);
          expect(r.h).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(w);
          expect(r.y + r.h).toBeLessThanOrEqual(h);
        }
      });

      it('leaves usable room for a label at working sizes', () => {
        const r = SHAPE_GEOMETRY[kind].labelInset(160, 100);
        expect(r.w).toBeGreaterThanOrEqual(40);
        expect(r.h).toBeGreaterThanOrEqual(24);
      });

      it('survives a degenerate box', () => {
        for (const [w, h] of [
          [0, 0],
          [-40, 12],
          [Number.NaN, 100],
        ] as ReadonlyArray<[number, number]>) {
          expect(() => SHAPE_GEOMETRY[kind].path(w, h)).not.toThrow();
          expect(SHAPE_GEOMETRY[kind].path(w, h)).not.toMatch(/NaN|Infinity/);
          const r = SHAPE_GEOMETRY[kind].labelInset(w, h);
          expect(Number.isFinite(r.x + r.y + r.w + r.h)).toBe(true);
        }
      });
    });
  }
});

describe('the palette vocabulary', () => {
  it('orders every shape exactly once', () => {
    expect([...SHAPE_ORDER].sort()).toEqual([...SHAPE_KINDS].sort());
  });

  it('names every shape in sentence case', () => {
    for (const kind of SHAPE_KINDS) {
      const label = SHAPE_LABEL[kind];
      expect(label.length).toBeGreaterThan(0);
      expect(label[0]).toBe(label[0]?.toUpperCase());
      expect(label.slice(1)).toBe(label.slice(1).toLowerCase());
    }
  });
});

describe('drawnSize', () => {
  const size = { w: 200, h: 100 };

  it('draws to the live box while a resize handle is being dragged', () => {
    // React Flow reports the drag box; the document still holds the old one.
    expect(drawnSize(360, 140, size)).toEqual({ w: 360, h: 140 });
  });

  it('falls back to the document, per axis, before React Flow has a box', () => {
    expect(drawnSize(undefined, undefined, size)).toEqual({ w: 200, h: 100 });
    expect(drawnSize(360, undefined, size)).toEqual({ w: 360, h: 100 });
    expect(drawnSize(undefined, 140, size)).toEqual({ w: 200, h: 140 });
  });

  it('never hands a generator a box it cannot draw', () => {
    expect(drawnSize(0, -12, size)).toEqual({ w: 1, h: 1 });
    expect(drawnSize(Number.NaN, Number.POSITIVE_INFINITY, size)).toEqual({ w: 1, h: 1 });
  });

  it('redraws the silhouette rather than stretching it', () => {
    // The contract at the top of the file, through the path the node takes: a
    // cylinder dragged to twice its width keeps the lip it had, where scaling a
    // drawing of the old box would have doubled it.
    const dragged = drawnSize(400, 100, size);
    // The lip is the `ry` the outline starts at: `M0 <ry>A<rx> <ry> ...`.
    const lipOf = (w: number, h: number): number =>
      Number(/^M0 ([\d.]+)A/.exec(SHAPE_GEOMETRY.cylinder.path(w, h))?.[1]);

    expect(SHAPE_GEOMETRY.cylinder.path(dragged.w, dragged.h)).toBe(
      SHAPE_GEOMETRY.cylinder.path(400, 100),
    );
    expect(lipOf(dragged.w, dragged.h)).toBe(lipOf(size.w, size.h));
    expect(SHAPE_GEOMETRY.cylinder.path(dragged.w, dragged.h)).not.toBe(
      SHAPE_GEOMETRY.cylinder.path(size.w, size.h),
    );
  });
});
