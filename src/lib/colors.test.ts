import { describe, expect, it } from 'vitest';
import { colorValue, isHexColor, normalizeHex } from '@/lib/colors';

describe('normalizeHex', () => {
  it('expands shorthand and drops the case', () => {
    expect(normalizeHex('#f00')).toBe('#ff0000');
    expect(normalizeHex('#F00')).toBe('#ff0000');
    expect(normalizeHex('#AB12CD')).toBe('#ab12cd');
  });

  it('accepts a missing hash and surrounding space', () => {
    expect(normalizeHex('f00')).toBe('#ff0000');
    expect(normalizeHex('  AB12CD ')).toBe('#ab12cd');
  });

  it('refuses anything that is not a hex colour', () => {
    for (const value of ['#ff', '#ff000', '#1234567', 'rgb(1,2,3)', 'neon', '#gg0000', '', 7, null]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });

  it('agrees with the API: only #RRGGBB may be stored', () => {
    expect(isHexColor('#ff0000')).toBe(true);
    expect(isHexColor('#f00')).toBe(false); // the API rejects it, so the client must too
    const normalised = normalizeHex('#f00');
    expect(normalised !== null && isHexColor(normalised)).toBe(true);
  });
});

describe('colorValue', () => {
  it('still renders shorthand left in an older document', () => {
    expect(colorValue('#f00')).toBe('#ff0000');
    expect(colorValue('#AA00FF')).toBe('#AA00FF');
    expect(colorValue('blue')).toBe('var(--temper-blue)');
  });
});
