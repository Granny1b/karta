import { describe, expect, it } from 'vitest';
import { matchShortcut } from '@/lib/keys';

/** Minimal stand-in for the DOM element `matchShortcut` type-checks against. */
class FakeElement {
  tagName: string;
  isContentEditable = false;
  constructor(tag: string) {
    this.tagName = tag;
  }
}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;

const canvas = new FakeElement('DIV');
const field = new FakeElement('INPUT');

function press(key: string, modifiers: Partial<KeyboardEvent> = {}, target: unknown = canvas): KeyboardEvent {
  return {
    key,
    target,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as unknown as KeyboardEvent;
}

describe('matchShortcut', () => {
  it('maps the section 9 table', () => {
    expect(matchShortcut(press('n'))).toBe('new-card');
    expect(matchShortcut(press('N', { shiftKey: true }))).toBe('new-note');
    expect(matchShortcut(press('Enter'))).toBe('open-editor');
    expect(matchShortcut(press('Escape'))).toBe('escape');
    expect(matchShortcut(press('Tab'))).toBe('toggle-view');
    expect(matchShortcut(press('Delete'))).toBe('delete');
    expect(matchShortcut(press('Backspace'))).toBe('delete');
    expect(matchShortcut(press('0', { ctrlKey: true }))).toBe('zoom-fit');
    expect(matchShortcut(press('1', { ctrlKey: true }))).toBe('zoom-100');
    expect(matchShortcut(press('z', { ctrlKey: true }))).toBe('undo');
    expect(matchShortcut(press('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(matchShortcut(press('d', { metaKey: true }))).toBe('duplicate');
    expect(matchShortcut(press('g', { ctrlKey: true }))).toBe('group');
    expect(matchShortcut(press('B', { ctrlKey: true, shiftKey: true }))).toBe('extract');
    expect(matchShortcut(press('k', { ctrlKey: true }))).toBe('search');
    expect(matchShortcut(press('7'))).toBe('color-7');
  });

  it('ignores unmapped keys and stays out of the way while typing', () => {
    expect(matchShortcut(press('q'))).toBe(null);
    expect(matchShortcut(press('8'))).toBe(null);
    expect(matchShortcut(press('n', { altKey: true }))).toBe(null);
    expect(matchShortcut(press('n', {}, field))).toBe(null);
    expect(matchShortcut(press('Delete', {}, field))).toBe(null);
    expect(matchShortcut(press('Escape', {}, field))).toBe('escape');
  });
});
