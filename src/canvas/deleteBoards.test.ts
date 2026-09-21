import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type BoardIndex, type BoardNode } from '@/domain/board';
import { describeContents } from '@/board/boardSubtree';
import { planBoardDeletion } from '@/canvas/deleteBoards';
import { makeBoardLink, makeCard } from '@/state/factories';

const index = (
  boards: { id: string; title: string; cards?: number; parent?: string; deleted?: boolean }[],
): BoardIndex => ({
  schemaVersion: SCHEMA_VERSION,
  updatedAt: '2026-01-01T00:00:00.000Z',
  boards: boards.map((b) => ({
    id: b.id,
    parentBoardId: b.parent ?? null,
    title: b.title,
    icon: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: b.deleted === true ? '2026-01-02T00:00:00.000Z' : null,
    // `children` is the index's own direct-child rollup and is not what the
    // plan counts: nesting is read from `parentBoardId`, at every depth.
    counts: { cards: b.cards ?? 0, done: 0, children: 0 },
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
    const plan = planBoardDeletion(
      [node.id],
      [node],
      index([
        { id: 'b1', title: 'World' },
        { id: 'b2', title: 'Zones', parent: 'b1' },
        { id: 'b3', title: 'Spawns', parent: 'b1' },
      ]),
    );
    expect(plan.withContent.map((b) => b.title)).toEqual(['World']);
    expect(plan.boards[0]?.children).toBe(2);
  });

  it('counts nested boards all the way down, and the cards on all of them', () => {
    // Deleting the tile deletes the board *and* what is nested inside it, so
    // the question asked first has to add up the whole subtree — a board that
    // looks empty can be holding three boards' worth of work one level down.
    const node = link('b1');
    const plan = planBoardDeletion(
      [node.id],
      [node],
      index([
        { id: 'b1', title: 'Systems', cards: 1 },
        { id: 'b2', title: 'Netcode', parent: 'b1', cards: 4 },
        { id: 'b3', title: 'Serialization', parent: 'b2', cards: 5 },
        { id: 'b4', title: 'Gone', parent: 'b1', cards: 9, deleted: true },
        { id: 'b5', title: 'Elsewhere', cards: 7 },
      ]),
    );
    expect(plan.boards[0]?.children).toBe(2);
    // A board already deleted is not deleted again, and its cards are not
    // counted as something about to be lost.
    expect(plan.boards[0]?.cards).toBe(10);
    expect(describeContents(plan.boards[0]!)).toBe('10 cards and 2 nested boards');
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
