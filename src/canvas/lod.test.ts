import { describe, expect, it } from 'vitest';
import { contentLod } from '@/canvas/lod';

describe('contentLod', () => {
  it('leaves an open card at the camera level', () => {
    expect(contentLod('full', false)).toBe('full');
    expect(contentLod('compact', false)).toBe('compact');
    expect(contentLod('title', false)).toBe('title');
    expect(contentLod('block', false)).toBe('block');
  });

  it('draws a collapsed card as its title alone', () => {
    expect(contentLod('full', true)).toBe('title');
    expect(contentLod('compact', true)).toBe('title');
    expect(contentLod('title', true)).toBe('title');
  });

  it('never turns the far-zoom block back into text', () => {
    expect(contentLod('block', true)).toBe('block');
  });
});
