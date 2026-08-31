import { describe, expect, it } from 'vitest';
import { makeCard, makeGroup, makeNote } from '@/state/factories';
import { MIN_NODE_SIZE, resizeGeometry } from '@/canvas/resize';

describe('resizeGeometry', () => {
  it('commits the rounded box, position included', () => {
    const card = makeCard({ position: { x: 0, y: 0 }, size: { w: 240, h: 140 } });
    expect(resizeGeometry(card, { x: -15.6, y: 8.2, width: 320.4, height: 200.5 })).toEqual({
      position: { x: -16, y: 8 },
      size: { w: 320, h: 201 },
    });
  });

  it('refuses to write nothing at all', () => {
    const note = makeNote({ position: { x: 24, y: 32 }, size: { w: 200, h: 160 } });
    expect(resizeGeometry(note, { x: 24, y: 32, width: 200, height: 160 })).toBeNull();
    // A hair of drag that rounds back to where it started is still nothing.
    expect(resizeGeometry(note, { x: 24.2, y: 31.6, width: 200.4, height: 160.2 })).toBeNull();
  });

  it('leaves a locked node alone', () => {
    const card = makeCard({ position: { x: 0, y: 0 }, size: { w: 240, h: 140 }, locked: true });
    expect(resizeGeometry(card, { x: 0, y: 0, width: 400, height: 300 })).toBeNull();
  });

  it('floors the size so a node cannot be shrunk out of reach', () => {
    const group = makeGroup({ position: { x: 0, y: 0 }, size: { w: 480, h: 360 } });
    expect(resizeGeometry(group, { x: 0, y: 0, width: 4, height: 4 })).toEqual({
      position: { x: 0, y: 0 },
      size: { ...MIN_NODE_SIZE.group },
    });
  });
});
