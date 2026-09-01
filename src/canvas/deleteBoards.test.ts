import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type BoardIndex, type BoardNode } from '@/domain/board';
import { describeContents, planBoardDeletion } from '@/canvas/deleteBoards';
import { makeBoardLink, makeCard } from '@/state/factories';

const index = (
  boards: { id: string; title: string; cards?: number; children?: number; deleted?: boolean }[],
): BoardIndex => ({
  schemaVersion: SCHEMA_VERSION,
  updatedAt: '2026-01-01T00:00:00.000Z',
  boards: boards.map((b) => ({
    id: b.id,
    parentBoardId: null,
    title: b.title,
    icon: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: b.deleted === true ? '2026-01-02T00:00:00.000Z' : null,
    counts: { cards: b.cards ?? 0, done: 0, children: b.children ?? 0 },
    ownerId: 'u1',
  })),
});

const link = (targetBoardId: string, cachedTitle = 'Linked'): BoardNode =>
  makeBoardLink({ targetBoardId, cachedTitle, cachedCounts: null, userId: 'u1' });

describe('planBoardDeletion', () => {
  it('finds nothing when nothing is selected', () => {
    expect(planBoardDeletion([], [], index([]))).toEqual({ boards: [], withContent: [] });
  });

  it('ignores nodes that are not board links', () => {
    const card = makeCard({ userId: 'u1', rank: 'a0' });
    expect(planBoardDeletion([card.id], [card], index([])).boards).toEqual([]);
  });

  it('names the board behind a selected link', () => {
    const node = link('b1');
    const plan = planBoardDeletion([node.id], [node], index([{ id: 'b1', title: 'Systems' }]));

    expect(plan.boards).toHaveLength(1);
    expect(plan.boards[0]?.title).toBe('Systems');
    expect(plan.boards[0]?.known).toBe(true);
    // Empty, so nothing to ask about.
    expect(plan.withContent).toEqual([]);
  });

  it('flags a board holding cards, which is the reason to ask', () => {
    const node = link('b1');
    const plan = planBoardDeletion([node.id], [node], index([{ id: 'b1', title: 'Systems', cards: 5 }]));
    expect(plan.withContent.map((b) => b.title)).toEqual(['Systems']);
    expect(plan.withContent[0]?.cards).toBe(5);
  });

  it('flags a board holding nested boards too', () => {
    const node = link('b1');
    const plan = planBoardDeletion([node.id], [node], index([{ id: 'b1', title: 'World', children: 2 }]));
    expect(plan.withContent.map((b) => b.title)).toEqual(['World']);
  });

  it('deletes a board once even when two links point at it', () => {
    const a = link('b1');
    const b = link('b1');
    const plan = planBoardDeletion([a.id, b.id], [a, b], index([{ id: 'b1', title: 'Systems' }]));
    expect(plan.boards).toHaveLength(1);
  });

  it('reports a link whose board the index does not know, rather than dropping it', () => {
    // The node still goes; the caller can say the board could not be found
    // instead of quietly doing half of what was asked.
    const node = link('missing', 'Gone');
    const plan = planBoardDeletion([node.id], [node], index([]));
    expect(plan.boards).toHaveLength(1);
    expect(plan.boards[0]?.known).toBe(false);
    expect(plan.boards[0]?.title).toBe('Gone');
    // An unknown board is never counted as content worth a prompt.
    expect(plan.withContent).toEqual([]);
  });

  it('treats an already-deleted board as unknown', () => {
    const node = link('b1');
    const plan = planBoardDeletion([node.id], [node], index([{ id: 'b1', title: 'Old', deleted: true }]));
    expect(plan.boards[0]?.known).toBe(false);
  });

  it('survives having no index at all', () => {
    const node = link('b1', 'Cached name');
    const plan = planBoardDeletion([node.id], [node], null);
    expect(plan.boards[0]?.title).toBe('Cached name');
    expect(plan.boards[0]?.known).toBe(false);
  });

  it('separates several links in one selection', () => {
    const a = link('b1');
    const b = link('b2');
    const plan = planBoardDeletion(
      [a.id, b.id],
      [a, b],
      index([
        { id: 'b1', title: 'Empty' },
        { id: 'b2', title: 'Full', cards: 3 },
      ]),
    );
    expect(plan.boards).toHaveLength(2);
    expect(plan.withContent.map((x) => x.title)).toEqual(['Full']);
  });
});

describe('describeContents', () => {
  const base = { linkNodeId: 'n', boardId: 'b', title: 'T', known: true };

  it('says empty when it is', () => {
    expect(describeContents({ ...base, cards: 0, children: 0 })).toBe('empty');
  });

  it('counts cards, singular and plural', () => {
    expect(describeContents({ ...base, cards: 1, children: 0 })).toBe('1 card');
    expect(describeContents({ ...base, cards: 4, children: 0 })).toBe('4 cards');
  });

  it('counts nested boards', () => {
    expect(describeContents({ ...base, cards: 0, children: 1 })).toBe('1 nested board');
  });

  it('names both when a board has both', () => {
    expect(describeContents({ ...base, cards: 2, children: 3 })).toBe('2 cards and 3 nested boards');
  });
});
