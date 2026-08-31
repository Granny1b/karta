import { describe, expect, it } from 'vitest';
import { insideDialog, ownsEnterActivation } from '@/canvas/useCanvasShortcuts';

/** Stands in for an element: only `closest` is asked about. */
function element(...selectorsThatMatch: string[]): EventTarget {
  const matches = new Set(selectorsThatMatch);
  return {
    closest(selectors: string): unknown {
      return [...matches].some((one) => selectors.includes(one)) ? { tag: 'ancestor' } : null;
    },
  } as unknown as EventTarget;
}

describe('ownsEnterActivation', () => {
  it('stands aside for a control the browser activates with Enter', () => {
    expect(ownsEnterActivation(element('button'))).toBe(true);
    expect(ownsEnterActivation(element('a[href]'))).toBe(true);
    expect(ownsEnterActivation(element('[role="menuitem"]'))).toBe(true);
  });

  it('keeps Enter for the canvas itself', () => {
    // The canvas surface, a node div, and the states with nothing focused.
    expect(ownsEnterActivation(element())).toBe(false);
    expect(ownsEnterActivation(null)).toBe(false);
    expect(ownsEnterActivation({} as EventTarget)).toBe(false);
  });
});

describe('insideDialog', () => {
  it('knows a modal even when it never announced itself', () => {
    expect(insideDialog(element('[role="dialog"]'))).toBe(true);
    expect(insideDialog(element('button'))).toBe(false);
    expect(insideDialog(null)).toBe(false);
  });
});
