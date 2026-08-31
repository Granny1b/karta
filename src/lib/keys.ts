/**
 * Keyboard shortcut matching (spec 9).
 *
 * `matchShortcut` maps a raw `KeyboardEvent` to a canonical action name, or
 * `null` when the event is not a shortcut. Typing inside a field never triggers
 * an action — `Escape` is the single exception, because it has to be able to
 * close the panel the field lives in.
 */

export type ShortcutName =
  | 'new-card'
  | 'new-note'
  | 'open-editor'
  | 'escape'
  | 'toggle-view'
  | 'zoom-fit'
  | 'zoom-100'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'group'
  | 'extract'
  | 'search'
  | `color-${1 | 2 | 3 | 4 | 5 | 6 | 7}`;

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the event originated inside a text field or a rich-text surface. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

export function matchShortcut(e: KeyboardEvent): ShortcutName | null {
  if (e.key === 'Escape') return 'escape';
  if (isEditableTarget(e.target)) return null;
  if (e.repeat && e.key !== 'Backspace' && e.key !== 'Delete') return null;

  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;

  if (mod) {
    if (e.altKey) return null;
    const lower = key.toLowerCase();
    switch (lower) {
      case '0':
        return 'zoom-fit';
      case '1':
        return 'zoom-100';
      case 'z':
        return e.shiftKey ? 'redo' : 'undo';
      case 'y':
        return 'redo';
      case 'd':
        return e.shiftKey ? null : 'duplicate';
      case 'g':
        return e.shiftKey ? null : 'group';
      case 'b':
        return e.shiftKey ? 'extract' : null;
      case 'k':
        return e.shiftKey ? null : 'search';
      default:
        return null;
    }
  }

  if (e.altKey) return null;

  if (key === 'Delete' || key === 'Backspace') return 'delete';
  if (key === 'Enter') return e.shiftKey ? null : 'open-editor';
  if (key === 'Tab') return e.shiftKey ? null : 'toggle-view';

  if (key === 'n' || key === 'N') return e.shiftKey ? 'new-note' : 'new-card';

  if (!e.shiftKey && key.length === 1 && key >= '1' && key <= '7') {
    return `color-${Number(key) as 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  }

  return null;
}
