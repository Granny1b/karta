import { describe, expect, it } from 'vitest';
import {
  PALETTE_MIME,
  carriesPaletteDrag,
  cascadeOffset,
  placementFor,
  readPaletteDrag,
  writePaletteDrag,
  type DragData,
} from '@/canvas/dragCreate';

/** `DataTransfer` does not exist outside a browser, and only this much is used. */
class FakeTransfer implements DragData {
  private readonly formats = new Map<string, string>();

  get types(): readonly string[] {
    return [...this.formats.keys()];
  }

  getData(format: string): string {
    return this.formats.get(format) ?? '';
  }

  setData(format: string, data: string): void {
    this.formats.set(format, data);
  }
}

describe('the palette payload', () => {
  it('round trips every kind an item can carry', () => {
    for (const choice of [
      { kind: 'card' },
      { kind: 'note' },
      { kind: 'text' },
      { kind: 'shape', shape: 'cylinder' },
    ] as const) {
      const data = new FakeTransfer();
      writePaletteDrag(data, choice, 'Label');
      expect(readPaletteDrag(data)).toEqual(choice);
    }
  });

  it('carries the human name as plain text, for anything outside the canvas', () => {
    const data = new FakeTransfer();
    writePaletteDrag(data, { kind: 'shape', shape: 'diamond' }, 'Diamond');
    expect(data.getData('text/plain')).toBe('Diamond');
  });

  it('recognises its own drag from the types alone, which is all a dragover sees', () => {
    const data = new FakeTransfer();
    expect(carriesPaletteDrag(data)).toBe(false);
    writePaletteDrag(data, { kind: 'card' }, 'Card');
    expect(carriesPaletteDrag(data)).toBe(true);
    expect(carriesPaletteDrag(null)).toBe(false);
  });

  it('reads nothing out of a drag that came from somewhere else', () => {
    expect(readPaletteDrag(null)).toBeNull();
    expect(readPaletteDrag(new FakeTransfer())).toBeNull();
  });

  it('refuses a payload it does not understand', () => {
    const cases = [
      'not json',
      JSON.stringify({ v: 99, choice: { kind: 'card' } }),
      JSON.stringify({ v: 1, choice: { kind: 'wormhole' } }),
      JSON.stringify({ v: 1, choice: { kind: 'shape', shape: 'trapezoid' } }),
      JSON.stringify({ v: 1 }),
    ];
    for (const raw of cases) {
      const data = new FakeTransfer();
      data.setData(PALETTE_MIME, raw);
      expect(readPaletteDrag(data)).toBeNull();
    }
  });
});

describe('placementFor', () => {
  it('centres the node on the pointer', () => {
    // A card is 240 × 140, and 8 px of that half-height is rounded off the grid.
    expect(placementFor({ kind: 'card' }, { x: 400, y: 300 })).toEqual({ x: 280, y: 232 });
  });

  it('lands on the 8 px grid, in both directions', () => {
    expect(placementFor({ kind: 'card' }, { x: 403, y: 300 })).toEqual({ x: 280, y: 232 });
    expect(placementFor({ kind: 'shape', shape: 'ellipse' }, { x: 0, y: 0 })).toEqual({ x: -80, y: -48 });
  });

  it('sizes each kind from its own default', () => {
    expect(placementFor({ kind: 'text' }, { x: 100, y: 100 })).toEqual({ x: -16, y: 80 });
  });
});

describe('cascadeOffset', () => {
  it('steps a repeated placement off the last one and then starts over', () => {
    expect([0, 1, 2, 3, 4, 5].map(cascadeOffset)).toEqual([0, 24, 48, 72, 96, 0]);
  });
});
