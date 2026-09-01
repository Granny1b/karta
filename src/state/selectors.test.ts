import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type BoardIndex } from '@/domain/board';
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
      schemaVersion: SCHEMA_VERSION,
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
      schemaVersion: SCHEMA_VERSION,
      updatedAt: '2026-01-01T00:00:00.000Z',
      boards: [summary('a', 'b', 'A'), summary('b', 'a', 'B')],
    };
    expect(() => boardTree(index)).not.toThrow();
    expect(boardTree(index)).toEqual([]);
  });
});

describe('boardTree and soft deletion', () => {
  const summary = (id: string, title: string, parentBoardId: string | null, deletedAt: string | null = null) => ({
    id,
    parentBoardId,
    title,
    icon: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt,
    counts: { cards: 0, done: 0, children: 0 },
    ownerId: 'u1',
  });

  const index = (boards: ReturnType<typeof summary>[]) => ({
    schemaVersion: SCHEMA_VERSION,
    updatedAt: '2026-01-01T00:00:00.000Z',
    boards,
  });

  /*
   * Reported as "the left panel isn't updating when I delete boards". The tree
   * is the one place a soft-deleted board must not appear: the document still
   * exists (blob soft delete is the 14-day undo behind it), so only `deletedAt`
   * separates a board that is gone from one that is not.
   */
  it('leaves a soft-deleted child out of its parent', () => {
    const tree = boardTree(
      index([summary('root', 'MMORPG', null), summary('gone', 'New board', 'root', '2026-01-02T00:00:00.000Z')]),
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toEqual([]);
  });

  it('does not resurrect it at the root either', () => {
    // Filtering the parent out of the map must not make its children orphans
    // that surface at the top — the deleted board has to be gone from the walk.
    const tree = boardTree(
      index([
        summary('root', 'MMORPG', null, '2026-01-02T00:00:00.000Z'),
        summary('child', 'Systems', 'root'),
      ]),
    );
    expect(tree.map((n) => n.summary.title)).toEqual(['Systems']);
  });

  it('keeps every board that is not deleted', () => {
    const tree = boardTree(
      index([
        summary('root', 'MMORPG', null),
        summary('a', 'Systems', 'root'),
        summary('b', 'World', 'root'),
        summary('c', 'Gone', 'root', '2026-01-02T00:00:00.000Z'),
      ]),
    );
    expect(tree[0]?.children.map((c) => c.summary.title)).toEqual(['Systems', 'World']);
  });
});
