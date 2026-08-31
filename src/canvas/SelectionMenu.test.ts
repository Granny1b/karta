import { describe, expect, it } from 'vitest';
import type { Id } from '@/domain/board';
import { makeCard, makeGroup, makeNote } from '@/state/factories';
import { matchShortcut, type ShortcutName } from '@/lib/keys';
import {
  moveFocus,
  readSelectionFacts,
  runSelectionAction,
  selectionMenuItems,
  type SelectionAction,
  type SelectionFacts,
  type SelectionOps,
} from '@/canvas/SelectionMenu';

/**
 * The menu on the selection is the answer to "it is not clear how you make the
 * other things on this board": a frame and a nested board had no mouse path at
 * all, only `Ctrl+G` and `Ctrl+Shift+B` written down in a dialog behind `?`.
 *
 * So two things are worth proving without a browser. First that the list tells
 * the truth about the selection it was built for — an item that offers to wrap
 * a frame in a frame, or to colour a locked node, teaches the wrong rule. And
 * second that every key it prints is a key the canvas really binds, checked
 * against `matchShortcut` itself rather than against a copy of the table.
 */

/** Minimal stand-in for the DOM element `matchShortcut` type-checks against. */
class FakeElement {
  tagName = 'DIV';
  isContentEditable = false;
}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;

/** Reads a hint the menu displays ("Ctrl+Shift+B") back as the press it promises. */
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

const itemFor = (facts: SelectionFacts, action: SelectionAction) => {
  const found = selectionMenuItems(facts).find((item) => item.action === action);
  return found;
};

describe('readSelectionFacts', () => {
  it('counts what the selection really holds, not what it claims to', () => {
    const card = makeCard({ id: 'a' });
    const locked = makeNote({ id: 'b', locked: true });
    const frame = makeGroup({ id: 'c' });
    const nodes = [card, locked, frame];

    const facts = readSelectionFacts(nodes, new Set(['a', 'b', 'c']), 2);
    expect(facts).toEqual({ nodes: 3, edges: 2, locked: 1, unlocked: 2, framable: 2 });
  });

  it('ignores an id the document no longer has', () => {
    const card = makeCard({ id: 'a' });
    // A node deleted under a stale selection is not something to duplicate.
    const facts = readSelectionFacts([card], new Set(['a', 'gone']), 0);
    expect(facts.nodes).toBe(1);
    expect(facts.framable).toBe(1);
  });

  it('reads an empty selection as empty, arrows included', () => {
    expect(readSelectionFacts([makeCard()], new Set<Id>(), 3)).toEqual({
      nodes: 0,
      edges: 3,
      locked: 0,
      unlocked: 0,
      framable: 0,
    });
  });
});

describe('selectionMenuItems', () => {
  const nothing = readSelectionFacts([], new Set<Id>(), 0);

  it('offers every operation whatever is selected, so the list can be learned', () => {
    const actions = (facts: SelectionFacts): SelectionAction[] =>
      selectionMenuItems(facts).map((item) => item.action);

    // Six rows either way: one of lock/unlock, never both, never neither.
    expect(actions(nothing)).toEqual(['group', 'extract', 'duplicate', 'colour', 'lock', 'delete']);
    expect(actions({ nodes: 2, edges: 0, locked: 2, unlocked: 0, framable: 2 })).toEqual([
      'group',
      'extract',
      'duplicate',
      'colour',
      'unlock',
      'delete',
    ]);
  });

  it('names the two operations that had no mouse path at all', () => {
    const labels = selectionMenuItems(nothing).map((item) => item.label);
    expect(labels).toContain('Group into a frame');
    expect(labels).toContain('Extract to a nested board');
  });

  it('turns everything off with a reason when nothing is selected', () => {
    for (const item of selectionMenuItems(nothing)) {
      expect(item.enabled).toBe(false);
      // Dimmed and mute is worse than absent: it has to say why.
      expect(item.reason).toBeTruthy();
    }
  });

  it('will not offer to wrap a frame in a frame', () => {
    const frames: SelectionFacts = { nodes: 2, edges: 0, locked: 0, unlocked: 2, framable: 0 };
    expect(itemFor(frames, 'group')?.enabled).toBe(false);
    expect(itemFor(frames, 'group')?.reason).toMatch(/frame/i);
    // Everything else still applies to a frame — it is a node like any other.
    expect(itemFor(frames, 'duplicate')?.enabled).toBe(true);
    expect(itemFor(frames, 'extract')?.enabled).toBe(true);
  });

  it('follows the lock, exactly where the handlers do', () => {
    const locked: SelectionFacts = { nodes: 1, edges: 0, locked: 1, unlocked: 0, framable: 1 };

    // `applyColor` and `removeSelection` skip locked nodes, so both are off...
    expect(itemFor(locked, 'colour')?.enabled).toBe(false);
    expect(itemFor(locked, 'colour')?.reason).toBe('Everything selected is locked');
    expect(itemFor(locked, 'delete')?.enabled).toBe(false);
    // ...and unlocking is the way out, so it is the one that is on.
    expect(itemFor(locked, 'unlock')?.enabled).toBe(true);
    expect(itemFor(locked, 'lock')).toBeUndefined();

    // Extract and duplicate move a locked node like any other, and say so.
    expect(itemFor(locked, 'extract')?.enabled).toBe(true);
    expect(itemFor(locked, 'duplicate')?.enabled).toBe(true);
  });

  it('locks a mixed selection rather than unlocking it', () => {
    const mixed: SelectionFacts = { nodes: 3, edges: 0, locked: 1, unlocked: 2, framable: 3 };
    expect(itemFor(mixed, 'lock')?.enabled).toBe(true);
    expect(itemFor(mixed, 'unlock')).toBeUndefined();
    expect(itemFor(mixed, 'colour')?.enabled).toBe(true);
  });

  it('lets an arrow alone be coloured and deleted, and nothing else', () => {
    const edgeOnly: SelectionFacts = { nodes: 0, edges: 1, locked: 0, unlocked: 0, framable: 0 };
    expect(itemFor(edgeOnly, 'colour')?.enabled).toBe(true);
    expect(itemFor(edgeOnly, 'delete')?.enabled).toBe(true);
    expect(itemFor(edgeOnly, 'group')?.enabled).toBe(false);
    expect(itemFor(edgeOnly, 'extract')?.enabled).toBe(false);
    expect(itemFor(edgeOnly, 'duplicate')?.enabled).toBe(false);
  });
});

describe('the keys the menu prints', () => {
  const facts: SelectionFacts = { nodes: 2, edges: 1, locked: 0, unlocked: 2, framable: 2 };

  /** What each row promises `matchShortcut` will do with its key. */
  const BOUND: Partial<Record<SelectionAction, ShortcutName>> = {
    group: 'group',
    extract: 'extract',
    duplicate: 'duplicate',
    delete: 'delete',
  };

  it('are keys the canvas really binds, to the action the row names', () => {
    for (const item of selectionMenuItems(facts)) {
      const expected = BOUND[item.action];
      if (!expected) continue;
      expect(item.shortcut, `${item.label} shows no key`).not.toBeNull();
      expect(matchShortcut(press(item.shortcut as string)), item.label).toBe(expected);
    }
  });

  it('says 1–7 for the colours, and all seven of them work', () => {
    expect(itemFor(facts, 'colour')?.shortcut).toBe('1–7');
    for (let key = 1; key <= 7; key += 1) {
      expect(matchShortcut(press(String(key)))).toBe(`color-${key}`);
    }
  });

  it('promises no key for lock, because spec 9 gives it none', () => {
    expect(itemFor(facts, 'lock')?.shortcut).toBeNull();
    expect(itemFor({ ...facts, locked: 2, unlocked: 0 }, 'unlock')?.shortcut).toBeNull();
  });
});

describe('runSelectionAction', () => {
  function spyOps(): SelectionOps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      facts: () => readSelectionFacts([], new Set<Id>(), 0),
      selectedNodeIds: () => [],
      openMenuAt: () => calls.push('openMenuAt'),
      group: () => calls.push('group'),
      extract: () => calls.push('extract'),
      duplicate: () => calls.push('duplicate'),
      applyColor: () => calls.push('applyColor'),
      setLocked: (locked) => calls.push(locked ? 'lock' : 'unlock'),
      remove: () => calls.push('remove'),
    };
  }

  it('runs the canvas handler the row names, and only that one', () => {
    const cases: Array<[SelectionAction, string]> = [
      ['group', 'group'],
      ['extract', 'extract'],
      ['duplicate', 'duplicate'],
      ['lock', 'lock'],
      ['unlock', 'unlock'],
      ['delete', 'remove'],
    ];

    for (const [action, expected] of cases) {
      const ops = spyOps();
      runSelectionAction(ops, action);
      expect(ops.calls, action).toEqual([expected]);
    }
  });

  it('does nothing for the colour row, which is a strip of swatches', () => {
    const ops = spyOps();
    runSelectionAction(ops, 'colour');
    expect(ops.calls).toEqual([]);
  });
});

describe('moveFocus', () => {
  it('walks the whole menu on either axis and wraps at both ends', () => {
    expect(moveFocus('ArrowDown', 0, 5)).toBe(1);
    expect(moveFocus('ArrowRight', 0, 5)).toBe(1);
    expect(moveFocus('ArrowDown', 4, 5)).toBe(0);
    expect(moveFocus('ArrowUp', 0, 5)).toBe(4);
    expect(moveFocus('ArrowLeft', 3, 5)).toBe(2);
    expect(moveFocus('Home', 3, 5)).toBe(0);
    expect(moveFocus('End', 0, 5)).toBe(4);
  });

  it('leaves every other key to the menu', () => {
    for (const key of ['Enter', 'Escape', 'Tab', 'a', ' ']) {
      expect(moveFocus(key, 0, 5)).toBeNull();
    }
  });

  it('has somewhere to go from nowhere: nothing focused yet is index -1', () => {
    // `indexOf` on the focused element answers -1 before the caret is in the
    // list, and the first arrow must land on an item rather than off the end.
    expect(moveFocus('ArrowDown', -1, 5)).toBe(0);
    expect(moveFocus('ArrowUp', -1, 5)).toBe(4);
  });

  it('answers nothing for an empty menu rather than dividing by zero', () => {
    expect(moveFocus('ArrowDown', 0, 0)).toBeNull();
  });
});
