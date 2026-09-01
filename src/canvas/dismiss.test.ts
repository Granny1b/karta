import { describe, expect, it } from 'vitest';
import { clickedOutside, type ContainerLike } from '@/canvas/dismiss';

/** Stands in for a DOM node: owns a set of things it contains. */
const box = (...children: unknown[]): ContainerLike => ({
  contains: (node) => children.includes(node),
});

const gear = Symbol('gear button');
const item = Symbol('menu item');
const swatch = Symbol('colour swatch');
const canvas = Symbol('the canvas behind it');

describe('clickedOutside', () => {
  it('is false for the control that owns the state', () => {
    expect(clickedOutside(gear, [box(gear), box(item)])).toBe(false);
  });

  /*
   * The bug this exists for. The menu is rendered through a portal, so it is
   * not inside the button that opened it. Checking only the button made every
   * click on the menu an outside click: the menu closed on pointerdown and the
   * click never landed on anything.
   */
  it('is false for a menu that is not a descendant of its button', () => {
    const menu = box(item, swatch);
    expect(clickedOutside(item, [box(gear), menu])).toBe(false);
    expect(clickedOutside(swatch, [box(gear), menu])).toBe(false);
  });

  it('is true for the same click when the menu is not listed', () => {
    // Precisely the shipped behaviour, kept as the thing not to go back to.
    expect(clickedOutside(item, [box(gear)])).toBe(true);
  });

  it('is true for anything genuinely outside', () => {
    expect(clickedOutside(canvas, [box(gear), box(item)])).toBe(true);
  });

  it('closes rather than persists when there is no target to judge', () => {
    expect(clickedOutside(null, [box(gear)])).toBe(true);
    expect(clickedOutside(undefined, [box(gear)])).toBe(true);
  });

  it('ignores anchors that are not mounted', () => {
    expect(clickedOutside(gear, [null, undefined, box(gear)])).toBe(false);
    expect(clickedOutside(canvas, [null, undefined])).toBe(true);
  });
});
