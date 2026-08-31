import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION, type BoardDoc, type BoardIndex, type Id, type Me } from '@/domain/board';
import { makeBoard, makeCard } from '@/state/factories';
import type { WalEntry } from '@/state/wal';

/* ------------------------------------------------------------------ *
 * A fake server with a clock of its own — the point of most of these
 * tests is that the client must not compare its clock against it.
 * ------------------------------------------------------------------ */

const BOARD_ID = '01BOARD';

interface Fake {
  doc: BoardDoc;
  etag: string;
  version: number;
  clockMs: number;
  puts: { doc: BoardDoc; ifMatch: string | null }[];
  boardGets: number;
  hold: boolean;
  waiting: (() => void)[];
  wal: WalEntry | null;
  walWrites: { doc: BoardDoc; etag: string | null }[];
  walClears: number;
}

function seedDoc(): BoardDoc {
  return {
    ...makeBoard({ title: 'Board', ownerId: 'u1', id: BOARD_ID }),
    nodes: [makeCard({ id: 'A', title: 'A' })],
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:30.000Z', // server clock, ahead of this browser
  };
}

const fake: Fake = {
  doc: seedDoc(),
  etag: '"v1"',
  version: 1,
  clockMs: Date.parse('2026-01-01T12:00:30.000Z'),
  puts: [],
  boardGets: 0,
  hold: false,
  waiting: [],
  wal: null,
  walWrites: [],
  walClears: 0,
};

function resetFake(): void {
  fake.doc = seedDoc();
  fake.etag = '"v1"';
  fake.version = 1;
  fake.clockMs = Date.parse('2026-01-01T12:00:30.000Z');
  fake.puts = [];
  fake.boardGets = 0;
  fake.hold = false;
  fake.waiting = [];
  fake.wal = null;
  fake.walWrites = [];
  fake.walClears = 0;
}

function releasePuts(): void {
  fake.hold = false;
  const waiting = fake.waiting;
  fake.waiting = [];
  for (const resume of waiting) resume();
}

/** Filled in by the mock factory below, so the store's `instanceof` checks hold. */
const real: { ApiError: typeof import('@/lib/api').ApiError | null } = { ApiError: null };

function apiError(status: number, message: string): Error {
  const ApiError = real.ApiError;
  if (!ApiError) throw new Error('the api mock has not been initialised');
  return new ApiError(status, message);
}

const fakeApi = {
  async me(): Promise<Me> {
    return { userId: 'u1', userDetails: 'u1', identityProvider: 'aad', userRoles: ['authenticated'] };
  },
  async getIndex(): Promise<BoardIndex> {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: fake.doc.updatedAt,
      boards: [
        {
          id: BOARD_ID,
          parentBoardId: null,
          title: fake.doc.title,
          icon: null,
          updatedAt: fake.doc.updatedAt,
          deletedAt: null,
          counts: { cards: fake.doc.nodes.length, done: 0, children: 0 },
          ownerId: 'u1',
        },
      ],
    };
  },
  async getBoard(_id: Id): Promise<{ doc: BoardDoc; etag: string }> {
    fake.boardGets += 1;
    return { doc: fake.doc, etag: fake.etag };
  },
  async putBoard(_id: Id, doc: BoardDoc, ifMatch: string | null): Promise<{ doc: BoardDoc; etag: string }> {
    fake.puts.push({ doc, ifMatch });
    if (fake.hold) await new Promise<void>((resume) => fake.waiting.push(resume));
    if (ifMatch !== fake.etag) throw apiError(412, 'This board changed somewhere else');
    fake.version += 1;
    fake.clockMs += 1_000;
    // `updatedAt` is stamped server-side on every PUT (api/src/functions/board-put.ts).
    fake.doc = { ...doc, updatedAt: new Date(fake.clockMs).toISOString() };
    fake.etag = `"v${fake.version}"`;
    return { doc: fake.doc, etag: fake.etag };
  },
  async snapshot(): Promise<{ snapshotName: string }> {
    return { snapshotName: 'snap' };
  },
};

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  real.ApiError = actual.ApiError;
  return { ...actual, api: fakeApi };
});

vi.mock('@/state/wal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/state/wal')>();
  return {
    ...actual,
    async writeWal(boardId: Id, doc: BoardDoc, etag: string | null): Promise<void> {
      fake.walWrites.push({ doc, etag });
      fake.wal = { boardId, doc, savedAt: new Date().toISOString(), etag };
    },
    async readWal(): Promise<WalEntry | null> {
      return fake.wal;
    },
    async clearWal(): Promise<void> {
      fake.walClears += 1;
      fake.wal = null;
    },
  };
});

type Store = typeof import('@/state/boardStore').useBoardStore;

/** A fresh module instance per test: the save pipeline keeps module-local state. */
async function freshStore(): Promise<Store> {
  vi.resetModules();
  const module = await import('@/state/boardStore');
  return module.useBoardStore;
}

async function openBoard(): Promise<Store> {
  const store = await freshStore();
  await store.getState().loadBoard(BOARD_ID);
  await vi.advanceTimersByTimeAsync(0);
  return store;
}

/** Let queued promises settle without moving any timer on. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

const titleOf = (doc: BoardDoc, id: Id): string => {
  const node = doc.nodes.find((n) => n.id === id);
  return node && node.kind === 'card' ? node.title : '';
};

beforeEach(() => {
  vi.useFakeTimers();
  resetFake();
  return () => {
    releasePuts();
    vi.useRealTimers();
  };
});

describe('the save pipeline', () => {
  it('adopts the server document as the baseline after a camera write', async () => {
    const store = await openBoard();
    store.getState().updateNode('A', { title: 'A edited' });
    await vi.advanceTimersByTimeAsync(1_600);
    expect(store.getState().dirty).toBe(false);

    const undoStack = store.getState().undoStack;
    expect(undoStack.length).toBe(1);
    const getsBefore = fake.boardGets;

    store.getState().setViewport({ x: -300, y: 40, zoom: 0.8 });
    expect(store.getState().dirty).toBe(false); // a camera move is not user work
    await vi.advanceTimersByTimeAsync(5_100);

    // The ETag and the baseline both come from the server's answer, so the
    // 20 s poll cannot read our own camera write as somebody else's change.
    expect(store.getState().etag).toBe(fake.etag);
    expect(store.getState().base?.updatedAt).toBe(fake.doc.updatedAt);

    await vi.advanceTimersByTimeAsync(21_000); // one poll
    expect(fake.boardGets).toBe(getsBefore); // no silent reload
    expect(store.getState().undoStack).toEqual(undoStack); // undo history intact
  });

  it('keeps saving after an edit lands during a camera write', async () => {
    const store = await openBoard();

    store.getState().setViewport({ x: -300, y: 40, zoom: 0.8 });
    fake.hold = true;
    await vi.advanceTimersByTimeAsync(5_100); // the camera PUT is on the wire

    store.getState().updateNode('A', { title: 'Edited mid-camera-write' });
    expect(store.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1_600); // autosave fires and has to wait

    releasePuts();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(store.getState().dirty).toBe(false);
    expect(store.getState().saveState).toBe('saved');
    expect(titleOf(fake.doc, 'A')).toBe('Edited mid-camera-write');
  });

  it('makes `await save()` a flush barrier for work made during another save', async () => {
    const store = await openBoard();

    store.getState().updateNode('A', { title: 'First' });
    fake.hold = true;
    await vi.advanceTimersByTimeAsync(1_600); // the first PUT is on the wire

    store.getState().updateNode('A', { title: 'Second' });
    const flushed = store.getState().save();

    releasePuts();
    await flushed;

    expect(titleOf(fake.doc, 'A')).toBe('Second');
    expect(store.getState().dirty).toBe(false);
    expect(fake.puts.length).toBe(2);
  });

  it('does not dirty the board when only the camera moved during a save', async () => {
    const store = await openBoard();

    store.getState().updateNode('A', { title: 'A edited' });
    fake.hold = true;
    await vi.advanceTimersByTimeAsync(1_600);

    store.getState().setViewport({ x: 120, y: 60, zoom: 1.5 });
    releasePuts();
    await settle();

    expect(store.getState().dirty).toBe(false);
    expect(store.getState().saveState).toBe('saved');
    expect(store.getState().doc?.viewport).toEqual({ x: 120, y: 60, zoom: 1.5 });
    expect(fake.walClears).toBeGreaterThan(0); // the entry is dropped after the 200
    expect(fake.puts.length).toBe(1); // no second full PUT for the camera

    // ...and the camera still reaches the server on its own debounce (spec 6.1).
    await vi.advanceTimersByTimeAsync(5_100);
    expect(fake.puts.length).toBe(2);
    expect(fake.doc.viewport).toEqual({ x: 120, y: 60, zoom: 1.5 });
  });

  it('sends every save with the ETag the server last handed out', async () => {
    const store = await openBoard();

    store.getState().updateNode('A', { title: 'One' });
    await vi.advanceTimersByTimeAsync(1_600);
    store.getState().setViewport({ x: 5, y: 5, zoom: 1 });
    await vi.advanceTimersByTimeAsync(5_100);
    store.getState().updateNode('A', { title: 'Two' });
    await vi.advanceTimersByTimeAsync(1_600);

    expect(fake.puts.map((p) => p.ifMatch)).toEqual(['"v1"', '"v2"', '"v3"']);
    expect(store.getState().saveState).toBe('saved');
    expect(titleOf(fake.doc, 'A')).toBe('Two');
  });
});

describe('the write-ahead log', () => {
  it('records the ETag each entry was written against', async () => {
    const store = await openBoard();
    store.getState().updateNode('A', { title: 'A edited' });
    await settle();

    expect(fake.walWrites.at(-1)?.etag).toBe('"v1"');
  });

  it('keeps an entry the server does not hold, however old its stamp looks', async () => {
    // Written by a browser running a minute slow, then never saved. The stamp is
    // older than the server's, which is exactly the case that used to delete it.
    fake.wal = {
      boardId: BOARD_ID,
      doc: {
        ...fake.doc,
        nodes: [makeCard({ id: 'A', title: 'Rescued', updatedAt: '2026-01-01T11:59:35.000Z' })],
        updatedAt: '2026-01-01T11:59:35.000Z',
      },
      savedAt: '2026-01-01T11:59:35.000Z',
      etag: '"v0"', // the server has moved on since
    };

    const store = await openBoard();
    const recovered = store.getState().walRecovery;

    expect(fake.walClears).toBe(0); // never destroyed on a clock comparison
    expect(fake.wal).not.toBeNull();
    expect(recovered).not.toBeNull();
    expect(recovered ? titleOf(recovered.doc, 'A') : '').toBe('Rescued');
  });

  it('drops an entry whose work the server already holds', async () => {
    fake.wal = {
      boardId: BOARD_ID,
      // Saved since; only the server-stamped `updatedAt` and the camera differ.
      doc: { ...fake.doc, updatedAt: '2026-01-01T11:59:35.000Z', viewport: { x: 9, y: 9, zoom: 2 } },
      savedAt: '2026-01-01T11:59:35.000Z',
      etag: '"v0"', // the clear after its own 200 did not land
    };

    const store = await openBoard();

    expect(fake.walClears).toBe(1);
    expect(store.getState().walRecovery).toBeNull();
  });

  it('keeps unsaved work when a server document replaces the board', async () => {
    const store = await openBoard();
    store.getState().updateNode('A', { title: 'Not saved yet' });
    await settle();
    const cleared = fake.walClears;

    const restored: BoardDoc = { ...fake.doc, title: 'Yesterday' };
    store.getState().replaceDoc(restored, '"v9"', 'Restore a snapshot');
    await settle();

    const entry = fake.wal;
    expect(fake.walClears).toBe(cleared); // the only copy of the edit survives
    expect(entry).not.toBeNull();
    expect(entry ? titleOf(entry.doc, 'A') : '').toBe('Not saved yet');
  });
});

/*
 * Every creation path on the canvas — the palette, the toolbar, a drop, a
 * double-click, a shortcut, a stub, the menu an arrow opens — ends in
 * `createAt`. What is asserted here is the promise that makes those paths
 * interchangeable: one gesture is one entry in the undo stack, whether it put
 * one thing on the board or two.
 */
describe('createAt', () => {
  it('commits a node and the arrow to it in a single write', async () => {
    const store = await openBoard();
    const { createAt } = await import('@/canvas/dragCreate');
    const before = store.getState().undoStack.length;

    const node = createAt(
      { kind: 'shape', shape: 'diamond' },
      { x: 400, y: 200 },
      { source: 'A', sides: { sourceHandle: 'right', targetHandle: 'left' } },
    );
    await settle();

    const doc = store.getState().doc;
    expect(node?.kind).toBe('shape');
    expect(store.getState().undoStack.length).toBe(before + 1);
    expect(doc?.nodes.some((n) => n.id === node?.id)).toBe(true);
    expect(doc?.edges).toHaveLength(1);
    expect(doc?.edges[0]).toMatchObject({
      source: 'A',
      target: node?.id,
      sourceHandle: 'right',
      targetHandle: 'left',
    });

    store.getState().undo();
    await settle();

    const undone = store.getState().doc;
    expect(undone?.nodes.some((n) => n.id === node?.id)).toBe(false);
    expect(undone?.edges).toHaveLength(0);
  });

  it('adds a node on its own when nothing asked for an arrow', async () => {
    const store = await openBoard();
    const { createAt } = await import('@/canvas/dragCreate');

    const node = createAt({ kind: 'text' }, { x: 0, y: 0 });
    await settle();

    expect(node?.kind).toBe('text');
    expect(store.getState().doc?.edges).toHaveLength(0);
  });
});
