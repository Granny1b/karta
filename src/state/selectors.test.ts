import { describe, expect, it } from 'vitest';
import type { BoardIndex } from '@/domain/board';
import { makeCard } from '@/state/factories';
import { boardTree, matchesFilter, progressOf } from '@/state/selectors';
import { EMPTY_FILTER } from '@/state/uiStore';

const summary = (id: string, parentBoardId: string | null, title: string, deletedAt: string | null = null) => ({
  id,
  parentBoardId,
  title,
  icon: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt,
  counts: { cards: 0, done: 0, children: 0 },
  ownerId: 'u',
});

describe('matchesFilter', () => {
  const card = makeCard({
    title: 'Networking',
    body: 'MMORPG kit',
    checklist: [{ id: 'c', text: 'Lobby', done: false, rank: 'a0' }],
    labelIds: ['L1'],
    statusId: 'S1',
  });

  it('ANDs facets and ORs the values inside one', () => {
    expect(matchesFilter(card, EMPTY_FILTER)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: 'mmorpg' })).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: 'lobby' })).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: 'nope' })).toBe(false);
    expect(matchesFilter(card, { ...EMPTY_FILTER, labelIds: ['L2', 'L1'] })).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, labelIds: ['L2'] })).toBe(false);
    expect(matchesFilter(card, { ...EMPTY_FILTER, statusIds: ['S1'], hasOpenChecklist: true })).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, hasDue: true })).toBe(false);
  });

  it('counts checklist progress', () => {
    expect(progressOf(card)).toEqual({ done: 0, total: 1 });
  });
});

describe('boardTree', () => {
  it('nests children, drops deleted boards and lifts orphans to the root', () => {
    const index: BoardIndex = {
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      boards: [
        summary('r', null, 'Root'),
        summary('c', 'r', 'Child'),
        summary('o', 'gone', 'Orphan'),
        summary('d', null, 'Deleted', '2026-01-01T00:00:00.000Z'),
      ],
    };
    const tree = boardTree(index);
    expect(tree.map((t) => t.summary.id)).toEqual(['o', 'r']);
    expect(tree[1].children.map((c) => c.summary.id)).toEqual(['c']);
  });

  it('survives a cyclic parent chain', () => {
    const index: BoardIndex = {
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      boards: [summary('a', 'b', 'A'), summary('b', 'a', 'B')],
    };
    expect(() => boardTree(index)).not.toThrow();
    expect(boardTree(index)).toEqual([]);
  });
});
