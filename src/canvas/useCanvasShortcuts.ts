import { useEffect, useRef } from 'react';
import type { ColorToken } from '@/domain/board';
import { TEMPER_TOKENS } from '@/lib/colors';
import { isEditableTarget, matchShortcut } from '@/lib/keys';

export interface CanvasShortcutHandlers {
  newCard(): void;
  newNote(): void;
  openEditor(): void;
  escape(): void;
  duplicate(): void;
  deleteSelection(): void;
  group(): void;
  extract(): void;
  zoomToFit(): void;
  zoomTo100(): void;
  selectAll(): void;
  applyColor(color: ColorToken): void;
  /** Arrow-key nudge, already scaled: 8 px, or 1 px with Shift. */
  nudge(dx: number, dy: number): void;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/**
 * The canvas half of the keyboard table (spec 9). Undo, redo, the view toggle
 * and global search belong to the shell and are deliberately left alone here.
 */
export function useCanvasShortcuts(enabled: boolean, handlers: CanvasShortcutHandlers): void {
  const latest = useRef(handlers);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      const h = latest.current;
      const editing = isEditableTarget(event.target);
      const mod = event.ctrlKey || event.metaKey;

      if (!editing && !mod && !event.altKey) {
        const arrow = ARROWS[event.key];
        if (arrow) {
          const step = event.shiftKey ? 1 : 8;
          event.preventDefault();
          h.nudge(arrow[0] * step, arrow[1] * step);
          return;
        }
      }

      if (mod && !event.altKey && !editing && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        h.selectAll();
        return;
      }

      const action = matchShortcut(event);
      if (!action) return;

      if (action.startsWith('color-')) {
        const index = Number(action.slice('color-'.length));
        const color: ColorToken | undefined = TEMPER_TOKENS[index - 1];
        if (!color) return;
        event.preventDefault();
        h.applyColor(color);
        return;
      }

      switch (action) {
        case 'new-card':
          event.preventDefault();
          h.newCard();
          break;
        case 'new-note':
          event.preventDefault();
          h.newNote();
          break;
        case 'open-editor':
          event.preventDefault();
          h.openEditor();
          break;
        case 'escape':
          if (editing) return;
          h.escape();
          break;
        case 'duplicate':
          event.preventDefault();
          h.duplicate();
          break;
        case 'delete':
          event.preventDefault();
          h.deleteSelection();
          break;
        case 'group':
          event.preventDefault();
          h.group();
          break;
        case 'extract':
          event.preventDefault();
          h.extract();
          break;
        case 'zoom-fit':
          event.preventDefault();
          h.zoomToFit();
          break;
        case 'zoom-100':
          event.preventDefault();
          h.zoomTo100();
          break;
        default:
          // toggle-view, search, undo and redo are handled by the shell.
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
