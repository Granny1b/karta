import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type BoardIndex, type BoardNode } from '@/domain/board';
import { describeContents } from '@/board/boardSubtree';
import { planBoardDeletion } from '@/canvas/deleteBoards';
import { makeBoardLink, makeCard } from '@/state/factories';

/** The board the tiles are on — the parent every tile's board is nested in, unless a test says otherwise. */
const HOST = 'host';

const index = (
  boards: { id: string; title: string; cards?: number; parent?: string | null; deleted?: boolean }[],
): BoardIndex => ({
  schemaVersion: SCHEMA_VERSION,
  updatedAt: '2026-01-01T00:00:00.000Z',
  boards: boards.map((b) => ({
    id: b.id,
    parentBoardId: b.parent === undefined ? HOST : b.parent,
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
    expect(planBoardDeletion([], [], index([]), HOST)).toEqual({ boards: [], withContent: [] });
  });

  it('ignores nodes that are not board links', () => {
    const card = makeCard({ userId: 'u1', rank: 'a0' });
    expect(planBoardDeletion([card.id], [card], index([]), HOST).boards).toEqual([]);
  });

  it('names the board behind a selected link', () => {
    const node = link('b1');
    const plan = planBoardDeletion([node.id], [node], index([{ id: 'b1', title: 'Systems' }]), HOST);

    expect(plan.boards).toHaveLength(1);
    expect(plan.boards[0]?.title).toBe('Systems');
    expect(plan.boards[0]?.known).toBe(true);
    // Empty, so nothing to ask about.
    expect(plan.withContent).toEqual([]);
  });

  it('flags a board holding cards, which is the reason to ask', () => {
    const node = link('b1');
    const plan = planBoardDeletion([node.id], [node], index([{ id: 'b1', title: 'Systems', cards: 5 }]), HOST);
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
      HOST,
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
      HOST,
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
    const plan = planBoardDeletion([a.id, b.id], [a, b], index([{ id: 'b1', title: 'Systems' }]), HOST);
    expect(plan.boards).toHaveLength(1);
  });

  it('reports a link whose board the index does not know, rather than dropping it', () => {
    // The node still goes; the caller can say the board could not be found
    // instead of quietly doing half of what was asked.
    const node = link('missing', 'Gone');
    const plan = planBoardDeletion([node.id], [node], index([]), HOST);
    expect(plan.boards).toHaveLength(1);
    expect(plan.boards[0]?.known).toBe(false);
    expect(plan.boards[0]?.title).toBe('Gone');
    // An unknown board is never counted as content worth a prompt.
    expect(plan.withContent).toEqual([]);
  });

  it('treats an already-deleted board as unknown', () => {
    const node = link('b1');
    const plan = planBoardDeletion([node.id], [node], index([{ id: 'b1', title: 'Old', deleted: true }]), HOST);
    expect(plan.boards[0]?.known).toBe(false);
  });

  it('survives having no index at all', () => {
    const node = link('b1', 'Cached name');
    const plan = planBoardDeletion([node.id], [node], null, HOST);
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
      HOST,
    );
    expect(plan.boards).toHaveLength(2);
    expect(plan.withContent.map((x) => x.title)).toEqual(['Full']);
  });

  /*
   * A tile is not always *the* doorway. Duplicate and paste copy a tile as it
   * is, target and all, so the same board can have several — and deleting one
   * of them deleted the board behind all of them, then swept the original tile
   * off the canvas as well. The rule the feature was built on is "when the tile
   * is the only thing standing for that board": only the tile on the board's
   * own parent, with no twin beside it, takes the board with it.
   */
  it('keeps a board that another tile on this board still opens', () => {
    const original = link('b1');
    const duplicate = link('b1');
    const plan = planBoardDeletion(
      [duplicate.id],
      [original, duplicate],
      index([{ id: 'b1', title: 'Systems', cards: 12 }]),
      HOST,
    );
    expect(plan.boards).toEqual([]);
    expect(plan.withContent).toEqual([]);
  });

  it('treats a tile to a board nested somewhere else as a shortcut, not its doorway', () => {
    // Copied from the board it lives on and pasted here: its real doorway is
    // still standing on 'elsewhere'.
    const pasted = link('b1');
    const plan = planBoardDeletion(
      [pasted.id],
      [pasted],
      index([
        { id: 'elsewhere', title: 'Elsewhere', parent: null },
        { id: 'b1', title: 'Systems', parent: 'elsewhere' },
      ]),
      HOST,
    );
    expect(plan.boards).toEqual([]);
  });

  it('never deletes the board the tile is standing on', () => {
    const self = link(HOST);
    const plan = planBoardDeletion(
      [self.id],
      [self],
      index([{ id: HOST, title: 'Here', parent: 'up' }, { id: 'up', title: 'Up', parent: null }]),
      HOST,
    );
    expect(plan.boards).toEqual([]);
  });

  it('never deletes a board above the one the tile is standing on', () => {
    // Deleting a tile that opens an ancestor would take the floor away: the
    // ancestor's subtree includes this very board.
    const toParent = link('parent');
    const toRoot = link('root');
    const plan = planBoardDeletion(
      [toParent.id, toRoot.id],
      [toParent, toRoot],
      index([
        { id: 'root', title: 'Root', parent: null },
        { id: 'parent', title: 'Parent', parent: 'root', cards: 4 },
        { id: HOST, title: 'Here', parent: 'parent' },
      ]),
      HOST,
    );
    expect(plan.boards).toEqual([]);
  });
});
