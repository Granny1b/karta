import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type BoardIndex } from '@/domain/board';
import {
  boardSubtree,
  boardToOpenAfterDelete,
  describeContents,
  subtreeTotals,
} from '@/board/boardSubtree';

/**
 * Deleting a board leaves two questions that used to be answered wrongly: what
 * else goes with it, and where the person standing in it ends up.
 *
 * Reported as "I deleted a board and the left panel went messy" — the boards
 * nested inside the deleted one stayed live, so the tree lifted every one of
 * them to the top level beside the root.
 */

const summary = (
  id: string,
  parentBoardId: string | null,
  title: string,
  extra: { cards?: number; deletedAt?: string } = {},
) => ({
  id,
  parentBoardId,
  title,
  icon: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: extra.deletedAt ?? null,
  counts: { cards: extra.cards ?? 0, done: 0, children: 0 },
  ownerId: 'u1',
});

const index = (boards: ReturnType<typeof summary>[]): BoardIndex => ({
  schemaVersion: SCHEMA_VERSION,
  updatedAt: '2026-01-01T00:00:00.000Z',
  boards,
});

/** MMORPG → Systems → Netcode → Serialization, plus a sibling and a stray. */
const project = index([
  summary('root', null, 'MMORPG', { cards: 1 }),
  summary('systems', 'root', 'Systems', { cards: 2 }),
  summary('netcode', 'systems', 'Netcode', { cards: 4 }),
  summary('serialization', 'netcode', 'Serialization', { cards: 5 }),
  summary('world', 'root', 'World', { cards: 3 }),
  summary('old', 'systems', 'Old', { cards: 9, deletedAt: '2026-01-02T00:00:00.000Z' }),
]);

describe('boardSubtree', () => {
  it('is empty when nothing is asked for', () => {
    expect(boardSubtree(project, [])).toEqual([]);
  });

  it('takes the board and everything nested under it, at every depth', () => {
    expect(boardSubtree(project, ['systems']).map((b) => b.id)).toEqual([
      'systems',
      'netcode',
      'serialization',
    ]);
  });

  it('leaves the rest of the tree alone', () => {
    const ids = boardSubtree(project, ['world']).map((b) => b.id);
    expect(ids).toEqual(['world']);
  });

  it('skips boards that are already deleted', () => {
    expect(boardSubtree(project, ['systems']).map((b) => b.id)).not.toContain('old');
    expect(boardSubtree(project, ['old'])).toEqual([]);
  });

  it('lists a board once when two roots overlap', () => {
    const ids = boardSubtree(project, ['systems', 'netcode']).map((b) => b.id);
    expect(ids).toEqual(['systems', 'netcode', 'serialization']);
  });

  it('says nothing about a board the index has never heard of', () => {
    expect(boardSubtree(project, ['nope'])).toEqual([]);
    expect(boardSubtree(null, ['root'])).toEqual([]);
  });

  it('cannot spin on a cyclic parent chain', () => {
    const cyclic = index([summary('a', 'b', 'A'), summary('b', 'a', 'B')]);
    expect(boardSubtree(cyclic, ['a']).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('cannot spin on a board that is its own parent', () => {
    const self = index([summary('a', 'a', 'A')]);
    expect(boardSubtree(self, ['a']).map((x) => x.id)).toEqual(['a']);
  });
});

describe('subtreeTotals', () => {
  it('counts the boards that go with it, not the board itself', () => {
    expect(subtreeTotals(project, 'systems')).toEqual({ boards: 2, cards: 11 });
  });

  it('is zero for a leaf', () => {
    expect(subtreeTotals(project, 'serialization')).toEqual({ boards: 0, cards: 5 });
  });

  it('is zero for a board nobody knows', () => {
    expect(subtreeTotals(project, 'nope')).toEqual({ boards: 0, cards: 0 });
  });
});

describe('boardToOpenAfterDelete', () => {
  const deleted = index([
    summary('root', null, 'MMORPG'),
    summary('systems', 'root', 'Systems', { deletedAt: '2026-01-02T00:00:00.000Z' }),
    summary('netcode', 'systems', 'Netcode', { deletedAt: '2026-01-02T00:00:00.000Z' }),
    summary('world', 'root', 'World'),
  ]);

  it('stays put when the open board is still there', () => {
    expect(boardToOpenAfterDelete(deleted, 'world')).toBeNull();
  });

  it('stays put when the index has never heard of the open board', () => {
    // The ordinary state of a board created a second ago. Moving somebody off
    // it because the index is a beat behind would be the worse bug.
    expect(boardToOpenAfterDelete(deleted, 'brand-new')).toBeNull();
    expect(boardToOpenAfterDelete(null, 'anything')).toBeNull();
  });

  it('goes up to the parent when the open board is deleted', () => {
    expect(boardToOpenAfterDelete(deleted, 'systems')).toBe('root');
  });

  it('keeps climbing past ancestors that went with it', () => {
    // The board on screen was nested inside the deleted one, so its parent is
    // gone too; the first thing still standing is what it lands on.
    expect(boardToOpenAfterDelete(deleted, 'netcode')).toBe('root');
  });

  it('falls back to the top of the tree when nothing above it survived', () => {
    const noParents = index([
      summary('gone', null, 'Gone', { deletedAt: '2026-01-02T00:00:00.000Z' }),
      summary('zebra', null, 'Zebra'),
      summary('apple', null, 'Apple'),
    ]);
    // The first row of the panel, which is sorted by title.
    expect(boardToOpenAfterDelete(noParents, 'gone')).toBe('apple');
  });

  it('has nowhere to send anyone when every board is deleted', () => {
    const empty = index([summary('gone', null, 'Gone', { deletedAt: '2026-01-02T00:00:00.000Z' })]);
    expect(boardToOpenAfterDelete(empty, 'gone')).toBeNull();
  });

  it('cannot spin climbing a cyclic parent chain of deleted boards', () => {
    const cyclic = index([
      summary('a', 'b', 'A', { deletedAt: '2026-01-02T00:00:00.000Z' }),
      summary('b', 'a', 'B', { deletedAt: '2026-01-02T00:00:00.000Z' }),
      summary('safe', null, 'Safe'),
    ]);
    expect(boardToOpenAfterDelete(cyclic, 'a')).toBe('safe');
  });
});

describe('describeContents', () => {
  it('says empty when it is', () => {
    expect(describeContents({ cards: 0, children: 0 })).toBe('empty');
  });

  it('counts cards, singular and plural', () => {
    expect(describeContents({ cards: 1, children: 0 })).toBe('1 card');
    expect(describeContents({ cards: 4, children: 0 })).toBe('4 cards');
  });

  it('counts nested boards', () => {
    expect(describeContents({ cards: 0, children: 1 })).toBe('1 nested board');
  });

  it('names both when a board has both', () => {
    expect(describeContents({ cards: 2, children: 3 })).toBe('2 cards and 3 nested boards');
  });
});
