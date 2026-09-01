import { describe, expect, it } from 'vitest';
import type { BoardSummary } from '@/domain/board';
import { chainFor } from '@/board/Breadcrumb';

const summary = (id: string, title: string, parentBoardId: string | null): BoardSummary => ({
  id,
  parentBoardId,
  title,
  icon: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  counts: { cards: 0, done: 0, children: 0 },
  ownerId: 'u1',
});

const boards = [
  summary('root', 'MMORPG', null),
  summary('systems', 'Systems', 'root'),
  summary('net', 'Networking', 'systems'),
];

describe('chainFor', () => {
  it('walks parents root first, ending at the open board', () => {
    expect(chainFor('net', boards).map((b) => b.title)).toEqual(['MMORPG', 'Systems', 'Networking']);
  });

  it('is just the root when the root is open', () => {
    expect(chainFor('root', boards).map((b) => b.title)).toEqual(['MMORPG']);
  });

  it('is empty with no board open', () => {
    expect(chainFor(null, boards)).toEqual([]);
  });

  /*
   * The regression. A board created moments ago is on the server and in the
   * server's index, but the client's copy only refreshed on a 20 s poll — so
   * walking it broke on the first step and the breadcrumb vanished entirely.
   * A board it cannot place must still show the board you are standing on.
   */
  it('still names the open board when the index has not caught up', () => {
    const chain = chainFor('brand-new', boards, 'New board');
    expect(chain.map((b) => b.title)).toEqual(['New board']);
    expect(chain[0]?.id).toBe('brand-new');
  });

  it('does the same before the index has loaded at all', () => {
    expect(chainFor('brand-new', undefined, 'New board').map((b) => b.title)).toEqual(['New board']);
  });

  it('has nothing to show when it knows neither the board nor its title', () => {
    expect(chainFor('brand-new', boards)).toEqual([]);
    expect(chainFor('brand-new', undefined)).toEqual([]);
  });

  it('stops rather than looping when a board claims itself as its parent', () => {
    const cyclic = [summary('a', 'A', 'b'), summary('b', 'B', 'a')];
    expect(chainFor('a', cyclic).map((b) => b.title)).toEqual(['B', 'A']);
  });

  it('stops at the highest ancestor the index actually holds', () => {
    // The parent is gone but the child is not: show what can be placed.
    const orphaned = [summary('child', 'Child', 'missing')];
    expect(chainFor('child', orphaned).map((b) => b.title)).toEqual(['Child']);
  });
});
