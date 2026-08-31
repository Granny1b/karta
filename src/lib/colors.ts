import type { ColorToken, EdgeSemantic, HexColor } from '@/domain/board';

/**
 * The steel tempering series (spec 8.1). Ordered — straw is the coolest oxide,
 * slate the uncoloured default — and bound to the number keys 1–7.
 */
export const TEMPER_TOKENS: readonly ColorToken[] = [
  'straw',
  'bronze',
  'copper',
  'purple',
  'blue',
  'teal',
  'slate',
];

const TOKEN_SET = new Set<string>(TEMPER_TOKENS);

/**
 * The only hex shape a document may *carry*. It is deliberately identical to
 * the API's rule (`api/src/domain/validate.ts`): a colour the client accepts
 * but the server refuses would make the board unsaveable for good.
 */
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * The shapes a *person or a model* may write: `#RGB`, `#RRGGBB`, either
 * without the hash, in any case. Everything that comes in through import is
 * folded into {@link HEX_RE} form by {@link normalizeHex} before it is stored.
 */
const LOOSE_HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The default colour of an uncoloured card. */
export const DEFAULT_COLOR_VAR = 'var(--temper-slate)';

export function isColorToken(value: unknown): value is ColorToken {
  return typeof value === 'string' && TOKEN_SET.has(value);
}

/** True only for the stored form — `#RRGGBB`, the shape the API accepts. */
export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX_RE.test(value);
}

/**
 * Canonicalise a hand-written hex colour to the stored `#rrggbb` form, or
 * `null` when the value is not a hex colour at all. Shorthand is expanded and
 * the leading hash is optional, because `#f00` and `f00` are both ordinary
 * model output — and both used to be written into the document verbatim,
 * where every later save was rejected.
 */
export function normalizeHex(value: unknown): HexColor | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!LOOSE_HEX_RE.test(trimmed)) return null;
  const digits = (trimmed.startsWith('#') ? trimmed.slice(1) : trimmed).toLowerCase();
  if (digits.length === 6) return `#${digits}`;
  return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
}

/**
 * A CSS colour for a node/edge colour field. Tokens resolve to the theme
 * variable so dark mode follows; custom hex values pass straight through.
 */
export function colorValue(c: ColorToken | HexColor | null): string {
  if (isColorToken(c)) return `var(--temper-${c})`;
  if (isHexColor(c)) return c;
  // Shorthand can still sit in a document written before import normalised it.
  return normalizeHex(c) ?? DEFAULT_COLOR_VAR;
}

/** Per-semantic edge defaults (spec 5.3). */
export const EDGE_STYLE: Record<
  EdgeSemantic,
  { color: string; dash?: string; width: number; marker: 'none' | 'arrow' | 'arrowopen' }
> = {
  relates: { color: 'var(--edge-relates)', width: 1.5, marker: 'none' },
  depends: { color: 'var(--edge-depends)', width: 2, marker: 'arrow' },
  blocks: { color: 'var(--edge-blocks)', dash: '6 4', width: 2, marker: 'arrow' },
  derives: { color: 'var(--edge-derives)', width: 2, marker: 'arrowopen' },
};

/** The semantic default colour, unless the edge overrides it. */
export function edgeColor(semantic: EdgeSemantic, override: ColorToken | HexColor | null): string {
  if (isColorToken(override) || normalizeHex(override) !== null) return colorValue(override);
  return EDGE_STYLE[semantic].color;
}
