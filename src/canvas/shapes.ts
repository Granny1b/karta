import type { ShapeKind } from '@/domain/board';

/**
 * The draw.io shape vocabulary (spec 5.2).
 *
 * Every shape is a path generator parameterised by the node's box, so a shape
 * resizes by being *redrawn*, never by being stretched: a resized cylinder
 * keeps a circular-looking lip, a resized rounded rectangle keeps its 10 px
 * corner. The second half of a geometry is `labelInset` — the rectangle text
 * may safely occupy — because a diamond and a triangle offer roughly a quarter
 * of the area their bounding boxes suggest, and a label that spills outside the
 * outline is the single thing that makes a diagram look homemade.
 *
 * Coordinates are the node's own pixel units, origin at its top-left corner.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeGeometry {
  /** SVG path data for a `w × h` box, drawn clockwise. */
  path(w: number, h: number): string;
  /** The rectangle a centred label can occupy without crossing the outline. */
  labelInset(w: number, h: number): Rect;
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Two decimals is finer than a canvas pixel and keeps `d` short. */
function n(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** No generator ever sees a zero, a negative, or a NaN box. */
function dim(value: number): number {
  return Number.isFinite(value) && value > 1 ? value : 1;
}

/** An elliptical arc to `(x, y)`, small and clockwise — the only kind used here. */
function arc(rx: number, ry: number, x: number, y: number): string {
  return `A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y)}`;
}

/** The breathing room a label keeps from the outline, on the canvas radius scale. */
const LABEL_PAD = 8;

function padOf(w: number, h: number): number {
  return clamp(Math.min(w, h) * 0.1, 2, LABEL_PAD);
}

/** The largest radius on the canvas scale (`--karta-r-frame`), never more than the box allows. */
const ROUND = 10;

function roundOf(w: number, h: number): number {
  return Math.min(ROUND, w / 4, h / 4);
}

/** Clips a computed label area to the node box, so it can never spill. */
function inside(w: number, h: number, r: Rect): Rect {
  const x = clamp(r.x, 0, w);
  const y = clamp(r.y, 0, h);
  return { x, y, w: clamp(r.w, 0, w - x), h: clamp(r.h, 0, h - y) };
}

function geometry(
  path: (w: number, h: number) => string,
  labelInset: (w: number, h: number) => Rect,
): ShapeGeometry {
  return {
    path: (w, h) => path(dim(w), dim(h)),
    labelInset: (w, h) => {
      const bw = dim(w);
      const bh = dim(h);
      return inside(bw, bh, labelInset(bw, bh));
    },
  };
}

/** The whole box, less the label padding — what a rectangle-ish shape offers. */
function boxInset(w: number, h: number): Rect {
  const p = padOf(w, h);
  return { x: p, y: p, w: w - 2 * p, h: h - 2 * p };
}

/** A centred fraction of the box, less a little padding on the tight axis. */
function centredInset(w: number, h: number, fw: number, fh: number): Rect {
  return { x: (w * (1 - fw)) / 2, y: (h * (1 - fh)) / 2, w: w * fw, h: h * fh };
}

/* ------------------------------------------------------------------ *
 * Shape constants
 * ------------------------------------------------------------------ */

/** The inscribed square of a circle, as a share of the diameter. */
const ELLIPSE_FIT = 0.707;

/** How far a hexagon's points are set in from its left and right edges. */
const hexInset = (w: number, h: number): number => Math.min(w * 0.25, h * 0.5);

/** How far a parallelogram leans, in x. */
const skewOf = (w: number, h: number): number => Math.min(w * 0.2, h * 0.4);

/** Half the height of a cylinder's lip ellipse. */
const lipOf = (w: number, h: number): number => Math.min(h * 0.18, w * 0.5);

/** The width of the side bars on a process box. */
const barOf = (w: number, h: number): number => Math.min(w * 0.12, h * 0.3);

/** A document's wave amplitude, as a share of the height. */
const WAVE = 0.09;
/**
 * A cubic reaches only 0.2887 of its control offset, so the offset that puts
 * the wave's crest and trough exactly on `base ± amplitude` is 1 / 0.2887.
 */
const WAVE_PULL = 3.4641;

/** The share of the height a callout's body takes; the rest is its tail. */
const CALLOUT_BODY = 0.78;

/**
 * The cloud, as the union outline of four overlapping lobes — a real cloud
 * rather than a blob. The lobes were laid out on the unit square (centres at
 * 0.18/0.70 r 0.18, 0.40/0.40 r 0.30, 0.66/0.44 r 0.24, 0.82/0.70 r 0.18), the
 * outline walked clockwise from the bottom of the left lobe to the bottom of
 * the right one, and the result normalised back onto the unit square. Scaling
 * that construction by `w` and `h` is an affine map, so every lobe stays a
 * circle-shaped arc under it and the outline never breaks — which is why the
 * radii below are fractions of both axes rather than one.
 */
const CLOUD_START = { x: 0.0527, y: 1 };
const CLOUD_ARCS: ReadonlyArray<{ rx: number; ry: number; x: number; y: number }> = [
  { rx: 0.18, ry: 0.2475, x: 0.1285, y: 0.5879 },
  { rx: 0.3, ry: 0.4125, x: 0.6258, y: 0.1409 },
  { rx: 0.24, ry: 0.33, x: 0.8821, y: 0.5927 },
  { rx: 0.18, ry: 0.2475, x: 0.9473, y: 1 },
];

/* ------------------------------------------------------------------ *
 * The vocabulary
 * ------------------------------------------------------------------ */

export const SHAPE_GEOMETRY: Record<ShapeKind, ShapeGeometry> = {
  rectangle: geometry(
    (w, h) => `M0 0H${n(w)}V${n(h)}H0Z`,
    (w, h) => boxInset(w, h),
  ),

  roundedRect: geometry(
    (w, h) => {
      const r = roundOf(w, h);
      return [
        `M${n(r)} 0`,
        `H${n(w - r)}`,
        arc(r, r, w, r),
        `V${n(h - r)}`,
        arc(r, r, w - r, h),
        `H${n(r)}`,
        arc(r, r, 0, h - r),
        `V${n(r)}`,
        arc(r, r, r, 0),
        'Z',
      ].join('');
    },
    (w, h) => boxInset(w, h),
  ),

  ellipse: geometry(
    (w, h) => {
      const rx = w / 2;
      const ry = h / 2;
      return `M0 ${n(ry)}${arc(rx, ry, w, ry)}${arc(rx, ry, 0, ry)}Z`;
    },
    (w, h) => centredInset(w, h, ELLIPSE_FIT, ELLIPSE_FIT),
  ),

  diamond: geometry(
    (w, h) => `M${n(w / 2)} 0L${n(w)} ${n(h / 2)}L${n(w / 2)} ${n(h)}L0 ${n(h / 2)}Z`,
    // The largest rectangle inscribed in a rhombus is half its box, centred.
    (w, h) => centredInset(w, h, 0.48, 0.46),
  ),

  triangle: geometry(
    (w, h) => `M${n(w / 2)} 0L${n(w)} ${n(h)}L0 ${n(h)}Z`,
    // Text sits in the wide lower half; the apex holds nothing.
    (w, h) => ({ x: w * 0.3, y: h * 0.44, w: w * 0.4, h: h * 0.48 }),
  ),

  hexagon: geometry(
    (w, h) => {
      const a = hexInset(w, h);
      return `M${n(a)} 0H${n(w - a)}L${n(w)} ${n(h / 2)}L${n(w - a)} ${n(h)}H${n(a)}L0 ${n(h / 2)}Z`;
    },
    (w, h) => {
      const a = hexInset(w, h);
      const p = padOf(w, h);
      return { x: a + p / 2, y: p, w: w - 2 * a - p, h: h - 2 * p };
    },
  ),

  cylinder: geometry(
    (w, h) => {
      const rx = w / 2;
      const ry = lipOf(w, h);
      return [
        // The silhouette: over the top, down the side, under the base.
        `M0 ${n(ry)}`,
        arc(rx, ry, w, ry),
        `V${n(h - ry)}`,
        arc(rx, ry, 0, h - ry),
        'Z',
        // The near edge of the lip, wound the same way so it fills as one body.
        `M${n(w)} ${n(ry)}`,
        arc(rx, ry, 0, ry),
      ].join('');
    },
    (w, h) => {
      const ry = lipOf(w, h);
      const p = padOf(w, h);
      const top = 2 * ry + p / 2;
      return { x: p, y: top, w: w - 2 * p, h: h - ry - top };
    },
  ),

  parallelogram: geometry(
    (w, h) => {
      const s = skewOf(w, h);
      return `M${n(s)} 0H${n(w)}L${n(w - s)} ${n(h)}H0Z`;
    },
    (w, h) => {
      const s = skewOf(w, h);
      const p = padOf(w, h);
      return { x: s + p / 2, y: p, w: w - 2 * s - p, h: h - 2 * p };
    },
  ),

  cloud: geometry(
    (w, h) => {
      let d = `M${n(CLOUD_START.x * w)} ${n(CLOUD_START.y * h)}`;
      for (const a of CLOUD_ARCS) d += arc(a.rx * w, a.ry * h, a.x * w, a.y * h);
      return `${d}Z`;
    },
    // Well inside all four lobes — checked against the construction above.
    (w, h) => ({ x: w * 0.16, y: h * 0.32, w: w * 0.68, h: h * 0.48 }),
  ),

  document: geometry(
    (w, h) => {
      const a = h * WAVE;
      const base = h - a;
      const pull = a * WAVE_PULL;
      return [
        'M0 0',
        `H${n(w)}`,
        `V${n(base)}`,
        // One S-curve: its crest lands on `h`, its trough on `h - 2a`.
        `C${n((w * 2) / 3)} ${n(base + pull)} ${n(w / 3)} ${n(base - pull)} 0 ${n(base)}`,
        'Z',
      ].join('');
    },
    (w, h) => {
      const p = padOf(w, h);
      // Above the trough of the wave, which is the highest the bottom edge rises.
      return { x: p, y: p, w: w - 2 * p, h: h * (1 - 2 * WAVE) - 2 * p };
    },
  ),

  process: geometry(
    (w, h) => {
      const b = barOf(w, h);
      return `M0 0H${n(w)}V${n(h)}H0Z M${n(b)} 0V${n(h)} M${n(w - b)} 0V${n(h)}`;
    },
    (w, h) => {
      const b = barOf(w, h);
      const p = padOf(w, h);
      return { x: b + p / 2, y: p, w: w - 2 * b - p, h: h - 2 * p };
    },
  ),

  callout: geometry(
    (w, h) => {
      const body = h * CALLOUT_BODY;
      const r = roundOf(w, body);
      const x2 = clamp(w * 0.42, r + 6, w - r);
      const x1 = clamp(w * 0.26, r, x2 - 4);
      const tip = clamp(w * 0.2, 0, x1);
      return [
        `M${n(r)} 0`,
        `H${n(w - r)}`,
        arc(r, r, w, r),
        `V${n(body - r)}`,
        arc(r, r, w - r, body),
        // The bottom edge, travelled right to left, drops out to the tail.
        `H${n(x2)}`,
        `L${n(tip)} ${n(h)}`,
        `L${n(x1)} ${n(body)}`,
        `H${n(r)}`,
        arc(r, r, 0, body - r),
        `V${n(r)}`,
        arc(r, r, r, 0),
        'Z',
      ].join('');
    },
    (w, h) => {
      const p = padOf(w, h);
      return { x: p, y: p, w: w - 2 * p, h: h * CALLOUT_BODY - 2 * p };
    },
  ),
};

/** Palette display order: the four everyday boxes first, the specialised ones after. */
export const SHAPE_ORDER: readonly ShapeKind[] = [
  'rectangle',
  'roundedRect',
  'ellipse',
  'diamond',
  'triangle',
  'hexagon',
  'parallelogram',
  'process',
  'document',
  'cylinder',
  'cloud',
  'callout',
];

/** Sentence case, like every other label in the product (spec 8.2). */
export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  roundedRect: 'Rounded rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  triangle: 'Triangle',
  hexagon: 'Hexagon',
  parallelogram: 'Parallelogram',
  process: 'Process',
  document: 'Document',
  cylinder: 'Cylinder',
  cloud: 'Cloud',
  callout: 'Callout',
};
