import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BoardDoc, BoardNode } from '@/domain/board';

/*
 * `deleteBoardsAndDescendants` reaches the network and the store, so both are
 * faked. What is worth pinning is what it decides to touch: which boards go,
 * and which board documents are rewritten to take the doorways down.
 *
 * Reported as "I deleted a board, the left panel went messy and the deleted
 * board is still reachable". Both halves of that were this function's job and
 * neither was being done: the nested boards were left live under a parent that
 * was gone, and the tile that opened the board stayed on the canvas.
 */
const deleteBoard = vi.fn();
const getBoard = vi.fn();
const putBoard = vi.fn();
const removeNodes = vi.fn();
const save = vi.fn();
const loadIndex = vi.fn();

let state: Record<string, unknown> = {};

vi.mock('@/lib/api', () => ({
  api: {
    deleteBoard: (...args: unknown[]) => deleteBoard(...args),
    getBoard: (...args: unknown[]) => getBoard(...args),
    putBoard: (...args: unknown[]) => putBoard(...args),
  },
  ApiError: class extends Error {},
}));
vi.mock('@/state/boardStore', () => ({
  useBoardStore: { getState: () => ({ ...state, removeNodes, save, loadIndex }) },
}));

const { deleteBoardsAndDescendants } = await import('@/board/deleteBoard');

const summary = (id: string, parentBoardId: string | null, deletedAt: string | null = null) => ({
  id,
  parentBoardId,
  title: id,
  icon: null,
  updatedAt: '',
  deletedAt,
  counts: { cards: 0, done: 0, children: 0 },
  ownerId: 'u1',
});

/** MMORPG → Systems → Netcode, and a sibling that must not be touched. */
const index = {
  schemaVersion: 5 as const,
  updatedAt: '',
  boards: [
    summary('root', null),
    summary('systems', 'root'),
    summary('netcode', 'systems'),
    summary('world', 'root'),
    summary('old', 'systems', '2026-01-02T00:00:00.000Z'),
  ],
};

const node = (id: string, kind: BoardNode['kind'], targetBoardId?: string): BoardNode =>
  ({ id, kind, targetBoardId, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }) as unknown as BoardNode;

const doc = (id: string, nodes: BoardNode[], edges: { id: string; source: string; target: string }[] = []) =>
  ({ id, nodes, edges }) as unknown as BoardDoc;

beforeEach(() => {
  vi.clearAllMocks();
  state = { boardId: null, doc: null, index };
  deleteBoard.mockResolvedValue(undefined);
  getBoard.mockResolvedValue({ doc: doc('root', []), etag: 'W/"1"' });
  putBoard.mockResolvedValue({ etag: 'W/"2"' });
});

describe('deleteBoardsAndDescendants', () => {
  it('deletes the board and everything nested inside it', async () => {
    const result = await deleteBoardsAndDescendants(['systems']);

    expect(deleteBoard.mock.calls.map((c) => c[0]).sort()).toEqual(['netcode', 'systems']);
    expect(result.deleted.slice().sort()).toEqual(['netcode', 'systems']);
    expect(result.failed).toBe(0);
  });

  it('leaves the boards beside it alone', async () => {
    await deleteBoardsAndDescendants(['systems']);
    expect(deleteBoard.mock.calls.map((c) => c[0])).not.toContain('world');
    expect(deleteBoard.mock.calls.map((c) => c[0])).not.toContain('root');
  });

  it('does not delete a board twice when a root and its child are both named', async () => {
    await deleteBoardsAndDescendants(['systems', 'netcode']);
    expect(deleteBoard).toHaveBeenCalledTimes(2);
  });

  it('names a board the index has not caught up with, rather than skipping it', async () => {
    // A board created a second ago is not in the index yet. The API decides.
    await deleteBoardsAndDescendants(['brand-new']);
    expect(deleteBoard).toHaveBeenCalledWith('brand-new');
  });

  it('takes the doorway off the parent board, under the ETag it read', async () => {
    const tile = node('n1', 'boardLink', 'systems');
    const other = node('n2', 'card');
    getBoard.mockResolvedValue({
      doc: doc('root', [tile, other], [{ id: 'e1', source: 'n1', target: 'n2' }]),
      etag: 'W/"7"',
    });

    await deleteBoardsAndDescendants(['systems']);

    expect(getBoard).toHaveBeenCalledWith('root');
    const [id, written, etag] = putBoard.mock.calls[0] as [string, BoardDoc, string];
    expect(id).toBe('root');
    expect(etag).toBe('W/"7"');
    expect(written.nodes.map((n) => n.id)).toEqual(['n2']);
    // An arrow to a node that no longer exists is not left behind either.
    expect(written.edges).toEqual([]);
  });

  it('does not write to a board that holds no doorway to what went', async () => {
    getBoard.mockResolvedValue({ doc: doc('root', [node('n2', 'card')]), etag: 'W/"1"' });
    await deleteBoardsAndDescendants(['systems']);
    expect(putBoard).not.toHaveBeenCalled();
  });

  it('does not write to a parent board that is being deleted itself', async () => {
    await deleteBoardsAndDescendants(['root']);
    // root, systems and netcode all go; nothing above them is left to sweep.
    expect(getBoard).not.toHaveBeenCalled();
    expect(putBoard).not.toHaveBeenCalled();
  });

  it('does not write to a parent board that was already deleted', async () => {
    // An orphan: the board above it went earlier, so there is no doorway left
    // on it worth a round trip.
    state = {
      boardId: null,
      doc: null,
      index: {
        ...index,
        boards: [summary('buried', null, '2026-01-02T00:00:00.000Z'), summary('orphan', 'buried')],
      },
    };

    await deleteBoardsAndDescendants(['orphan']);

    expect(deleteBoard).toHaveBeenCalledWith('orphan');
    expect(getBoard).not.toHaveBeenCalled();
  });

  it('takes the doorway off the open board through the store, not a round trip', async () => {
    state = {
      boardId: 'root',
      doc: doc('root', [node('n1', 'boardLink', 'netcode'), node('n2', 'card')]),
      index,
    };

    await deleteBoardsAndDescendants(['systems']);

    expect(removeNodes).toHaveBeenCalledWith(['n1']);
    expect(save).toHaveBeenCalled();
    expect(getBoard).not.toHaveBeenCalled();
  });

  it('reports a delete that was refused instead of throwing', async () => {
    deleteBoard.mockImplementation((id: string) =>
      id === 'netcode' ? Promise.reject(new Error('403')) : Promise.resolve(undefined),
    );

    const result = await deleteBoardsAndDescendants(['systems']);

    expect(result.deleted).toEqual(['systems']);
    expect(result.failed).toBe(1);
  });

  it('reports a doorway it could not take down, and deletes the board anyway', async () => {
    getBoard.mockResolvedValue({ doc: doc('root', [node('n1', 'boardLink', 'systems')]), etag: 'W/"1"' });
    putBoard.mockRejectedValue(new Error('412'));

    const result = await deleteBoardsAndDescendants(['systems']);

    expect(result.deleted.slice().sort()).toEqual(['netcode', 'systems']);
    expect(result.doorwaysLeft).toBe(1);
  });

  it('refreshes the index before it returns, so the tree is current', async () => {
    await deleteBoardsAndDescendants(['systems']);
    expect(loadIndex).toHaveBeenCalledOnce();
  });

  it('does nothing at all when asked for nothing', async () => {
    const result = await deleteBoardsAndDescendants([]);
    expect(deleteBoard).not.toHaveBeenCalled();
    expect(loadIndex).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: [], failed: 0, doorwaysLeft: 0 });
  });
});
