import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The token file is only a single source of truth while nothing writes its
 * values out again. Nothing here checks how the product looks — that is not
 * something a test can see — but every failure below is a value written twice,
 * which is the one defect that always ends as two surfaces quietly disagreeing:
 * a drag shadow that never darkens at night, a card title that reflows when the
 * webfont lands, a corner of furniture 3 px off the one beside it.
 *
 * These are the stylesheets that may declare a value. Anything outside them
 * reads a token or writes a number that belongs to one element only.
 */
const SHEETS = [
  'src/styles/tokens.css',
  'src/styles/index.css',
  'src/styles/canvas-chrome.css',
  'src/canvas/canvas.css',
  'src/canvas/connect.css',
] as const;

type Sheet = (typeof SHEETS)[number];

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

/** Comments explain the numbers, so they are not evidence of them. */
const code = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

const source: Record<Sheet, string> = Object.fromEntries(
  SHEETS.map((rel) => [rel, code(read(rel))]),
) as Record<Sheet, string>;

/** Sheets that may not write a value a token already holds. */
const CALLERS = SHEETS.filter((rel) => rel !== 'src/styles/tokens.css');

const namesOf = (css: string, pattern: RegExp): Set<string> => {
  const found = new Set<string>();
  for (const m of css.matchAll(pattern)) {
    const name = m[1];
    if (name !== undefined) found.add(name);
  }
  return found;
};

const declarations = (css: string): Set<string> => namesOf(css, /(--[a-z0-9-]+)\s*:/g);
const references = (css: string): Set<string> => namesOf(css, /var\(\s*(--[a-z0-9-]+)/g);

/** The rule body for an exact selector, so `.karta-dock` is not `.karta-dock-chip`. */
function body(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const TOKENS = source['src/styles/tokens.css'];
const CANVAS = source['src/canvas/canvas.css'];
const [LIGHT = '', DARK = ''] = TOKENS.split("[data-theme='dark']");

describe('the token file', () => {
  it('overrides nothing at night that the light root does not declare', () => {
    for (const name of declarations(DARK)) {
      expect(declarations(LIGHT), `${name} is a dark-only token`).toContain(name);
    }
  });

  it('is read for every custom property the stylesheets name', () => {
    const declared = new Set(SHEETS.flatMap((rel) => [...declarations(source[rel])]));
    for (const rel of SHEETS) {
      for (const name of references(source[rel])) {
        expect(declared, `${rel} reads ${name}, which nothing declares`).toContain(name);
      }
    }
  });

  it('holds the only two durations, and both are used', () => {
    expect(declarations(LIGHT)).toContain('--dur-fast');
    expect(declarations(LIGHT)).toContain('--dur-base');

    // 90, 120 and 140 were all written out by hand at some point. A third speed
    // is not a decision, it is a value nobody checked against the other two.
    for (const rel of CALLERS) {
      expect(source[rel], `${rel} writes a duration a token already names`).not.toMatch(
        /\b(90|120|140)ms\b/,
      );
    }
  });

  it('holds the only font stacks', () => {
    // `--font-condensed` carries the metric-matched fallback face; a stack
    // spelled out at a call site is a stack that will be missing it.
    for (const rel of CALLERS) {
      expect(source[rel], `${rel} spells out a font family`).not.toMatch(/IBM Plex/);
    }
  });

  it('holds the only drag shadow, at both depths', () => {
    expect(declarations(LIGHT)).toContain('--shadow-drag');
    expect(declarations(DARK), 'the drag shadow has no night depth').toContain('--shadow-drag');

    const readers = CALLERS.filter((rel) => references(source[rel]).has('--shadow-drag'));
    expect(readers.length, 'nothing reads --shadow-drag').toBeGreaterThan(0);

    for (const rel of CALLERS) {
      expect(source[rel], `${rel} draws the drag shadow itself`).not.toMatch(/10px\s+24px/);
    }
  });
});

describe('the canvas furniture', () => {
  it('stands on one inset', () => {
    for (const selector of [
      '.karta-dock',
      '.karta-canvas .react-flow__controls',
      '.karta-canvas .react-flow__attribution',
    ]) {
      expect(body(CANVAS, selector), `${selector} picks its own inset`).toMatch(
        /var\(--karta-inset\)/,
      );
    }

    expect(CANVAS, 'the canvas does not name its inset').toMatch(/--karta-inset\s*:/);
    expect(CANVAS, 'a 12 px inset is still written out').not.toMatch(/\b12px\b/);
  });

  it('answers the 15 px margin React Flow gives its own panels', () => {
    // Without this the zoom controls sit 27 px in while everything else sits on
    // 12, which is the whole defect: an inset that is never seen and always felt.
    for (const selector of [
      '.karta-canvas .react-flow__controls',
      '.karta-canvas .react-flow__attribution',
    ]) {
      expect(body(CANVAS, selector), `${selector} inherits the library's margin`).toMatch(
        /margin:\s*0\s*;/,
      );
    }
  });

  it('keeps the credit clear of the controls above it', () => {
    // Two panels in one corner: the credit holds the inset, the controls stand
    // on top of it. Both read the same height, or they overlap.
    expect(body(CANVAS, '.karta-canvas .react-flow__attribution')).toMatch(
      /line-height:\s*var\(--karta-credit-h\)/,
    );
    expect(body(CANVAS, '.karta-canvas .react-flow__controls')).toMatch(
      /bottom:\s*calc\(var\(--karta-inset\)\s*\+\s*var\(--karta-credit-h\)\)/,
    );
  });

  it('draws card titles in the condensed token, on the title leading', () => {
    const title = body(CANVAS, '.karta-card-title');
    expect(title).toMatch(/font-family:\s*var\(--font-condensed\)/);
    expect(title).toMatch(/line-height:\s*var\(--leading-tight\)/);
  });
});
