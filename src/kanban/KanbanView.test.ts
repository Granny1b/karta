import { describe, expect, it } from 'vitest';
import type { CardNode } from '@/domain/board';
import { makeCard } from '@/state/factories';
import { dropRank } from '@/kanban/KanbanView';

/*
 * A drop is placed against what the column shows, but ranked against all of
 * it: with a filter on, a hidden card still holds its rank, and a new rank
 * equal to it ties the two — after which drops between them go astray.
 */

const card = (id: string, rank: string): CardNode => makeCard({ id, title: id, rank });

describe('dropRank', () => {
  it('never lands on the rank of a hidden card between two visible ones', () => {
    const a = card('A', 'a0');
    const hidden = card('H', 'a1');
    const b = card('B', 'a2');

    // Dropped between A and B, which is all the filter lets the user see.
    const rank = dropRank([a, hidden, b], [a, b], 'X', 1);

    expect(rank).not.toBe(hidden.rank);
    expect(rank > a.rank && rank < b.rank).toBe(true);
  });

  it('never lands on the rank of the only card in a column the filter emptied', () => {
    const hidden = card('H', 'a0');
    expect(dropRank([hidden], [], 'X', 0)).not.toBe(hidden.rank);
  });

  it('never lands on a hidden card after the last visible one', () => {
    const a = card('A', 'a0');
    const b = card('B', 'a1');
    const hidden = card('H', 'a2');

    const rank = dropRank([a, b, hidden], [a, b], 'X', 2);

    expect(rank).not.toBe(hidden.rank);
    expect(rank > b.rank).toBe(true);
  });

  it('places a card exactly where it was dropped when nothing is hidden', () => {
    const a = card('A', 'a0');
    const b = card('B', 'a1');
    const c = card('C', 'a2');

    expect(dropRank([a, b, c], [a, b, c], 'X', 0) < a.rank).toBe(true);
    const between = dropRank([a, b, c], [a, b, c], 'X', 2);
    expect(between > b.rank && between < c.rank).toBe(true);
    expect(dropRank([a, b, c], [a, b, c], 'X', 3) > c.rank).toBe(true);
  });

  it('ignores the dragged card itself when working out its neighbours', () => {
    const a = card('A', 'a0');
    const b = card('B', 'a1');
    const c = card('C', 'a2');

    // A dragged below B: the list it lands in is [B, C] once A is lifted out.
    const rank = dropRank([a, b, c], [a, b, c], 'A', 1);

    expect(rank > b.rank && rank < c.rank).toBe(true);
  });
});
