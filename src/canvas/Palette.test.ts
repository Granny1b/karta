import { describe, expect, it } from 'vitest';
import { matchShortcut, type ShortcutName } from '@/lib/keys';
import { CARD_ENTRIES, SHAPE_ENTRIES, SHAPE_KEY } from '@/canvas/Palette';

/**
 * The palette is the surface that makes creation discoverable (spec 8.3), so a
 * hint it shows has to be a key the canvas really binds, and a key the canvas
 * binds has to appear on it. Both halves are checked against `matchShortcut`
 * itself rather than against a copy of the table.
 */

/** Minimal stand-in for the DOM element `matchShortcut` type-checks against. */
class FakeElement {
  tagName = 'DIV';
  isContentEditable = false;
}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;

/** Reads a hint the palette displays ("Shift+N") back as the press it promises. */
function press(hint: string): KeyboardEvent {
  const parts = hint.split('+');
  return {
    key: parts[parts.length - 1] ?? '',
    target: new FakeElement(),
    repeat: false,
    ctrlKey: parts.includes('Ctrl'),
    metaKey: false,
    shiftKey: parts.includes('Shift'),
    altKey: false,
  } as unknown as KeyboardEvent;
}

describe('the palette hints', () => {
  it('give every card kind the key that does the same thing', () => {
    for (const entry of CARD_ENTRIES) {
      expect(entry.shortcut).not.toBeNull();
      expect(matchShortcut(press(entry.shortcut ?? ''))).toBe(`new-${entry.choice.kind}`);
    }
  });

  it('hang the shapes key on the group, because no shape has one of its own', () => {
    // `S` opens the picker rather than placing any of the twelve, so a per-cell
    // hint would be a promise the key does not keep.
    expect(matchShortcut(press(SHAPE_KEY.key))).toBe('new-shape');
    expect(SHAPE_KEY.does).toBe('Pick a shape');
    for (const entry of SHAPE_ENTRIES) expect(entry.shortcut).toBeNull();
  });

  it('leave no way of making something on the canvas untaught', () => {
    const taught = new Set(
      [...CARD_ENTRIES.map((entry) => entry.shortcut ?? ''), SHAPE_KEY.key].map((hint) =>
        matchShortcut(press(hint)),
      ),
    );
    const creation: ShortcutName[] = ['new-card', 'new-note', 'new-text', 'new-shape'];
    for (const name of creation) expect(taught.has(name)).toBe(true);
  });
});
