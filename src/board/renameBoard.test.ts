import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MAX_TITLE } from '@/domain/board';

/*
 * renameBoard reaches the network and the store, so both are faked. What is
 * worth pinning is the decision it makes before either: which of the two paths
 * a board takes, and when it declines to do anything at all.
 */
const putBoard = vi.fn();
const getBoard = vi.fn();
const mutate = vi.fn();
const save = vi.fn();
const loadIndex = vi.fn();
const toast = vi.fn();

let state: Record<string, unknown> = {};

vi.mock('@/lib/api', () => ({
  api: {
    getBoard: (...args: unknown[]) => getBoard(...args),
    putBoard: (...args: unknown[]) => putBoard(...args),
  },
  ApiError: class extends Error {},
}));
vi.mock('@/state/boardStore', () => ({
  useBoardStore: { getState: () => ({ ...state, mutate, save, loadIndex }) },
}));
vi.mock('@/state/uiStore', () => ({ useUiStore: { getState: () => ({ toast }) } }));

const { renameBoard } = await import('@/board/renameBoard');

const index = (boards: { id: string; title: string }[]) => ({
  schemaVersion: 5 as const,
  updatedAt: '',
  boards: boards.map((b) => ({
    ...b,
    parentBoardId: null,
    icon: null,
    updatedAt: '',
    deletedAt: null,
    counts: { cards: 0, done: 0, children: 0 },
    ownerId: 'u1',
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  state = { boardId: 'open', index: index([{ id: 'open', title: 'Open' }, { id: 'other', title: 'Other' }]) };
  getBoard.mockResolvedValue({ doc: { id: 'other', title: 'Other' }, etag: 'W/"1"' });
  putBoard.mockResolvedValue({ etag: 'W/"2"' });
});

describe('renameBoard', () => {
  it('renames the open board through the store, so it undoes like any edit', async () => {
    expect(await renameBoard('open', 'Renamed')).toBe(true);
    expect(mutate).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(getBoard).not.toHaveBeenCalled();
  });

  it('renames another board under the ETag it read', async () => {
    expect(await renameBoard('other', 'Renamed')).toBe(true);
    expect(getBoard).toHaveBeenCalledWith('other');
    // The write is guarded by the etag from the read: a compare-and-swap.
    expect(putBoard).toHaveBeenCalledWith('other', { id: 'other', title: 'Renamed' }, 'W/"1"', []);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('refreshes the index either way, since it carries the title', async () => {
    await renameBoard('open', 'A');
    await renameBoard('other', 'B');
    expect(loadIndex).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a blank name', async () => {
    expect(await renameBoard('other', '   ')).toBe(false);
    expect(putBoard).not.toHaveBeenCalled();
  });

  it('does nothing when the name has not changed', async () => {
    expect(await renameBoard('other', 'Other')).toBe(false);
    expect(await renameBoard('other', '  Other  ')).toBe(false);
    expect(putBoard).not.toHaveBeenCalled();
  });

  it('caps a name the API would refuse', async () => {
    await renameBoard('other', 'x'.repeat(MAX_TITLE + 50));
    const title = (putBoard.mock.calls[0]?.[1] as { title: string }).title;
    expect(title).toHaveLength(MAX_TITLE);
  });

  it('says so rather than throwing when the write is refused', async () => {
    putBoard.mockRejectedValueOnce(new Error('412'));
    expect(await renameBoard('other', 'Renamed')).toBe(false);
    expect(toast).toHaveBeenCalledWith('Could not rename the board', 'error');
  });
});
