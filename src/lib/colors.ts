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
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The default colour of an uncoloured card. */
export const DEFAULT_COLOR_VAR = 'var(--temper-slate)';

export function isColorToken(value: unknown): value is ColorToken {
  return typeof value === 'string' && TOKEN_SET.has(value);
}

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX_RE.test(value);
}

/**
 * A CSS colour for a node/edge colour field. Tokens resolve to the theme
 * variable so dark mode follows; custom hex values pass straight through.
 */
export function colorValue(c: ColorToken | HexColor | null): string {
  if (isColorToken(c)) return `var(--temper-${c})`;
  if (isHexColor(c)) return c;
  return DEFAULT_COLOR_VAR;
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
  if (isColorToken(override) || isHexColor(override)) return colorValue(override);
  return EDGE_STYLE[semantic].color;
}
