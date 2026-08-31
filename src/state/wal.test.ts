import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION, type BoardDoc } from '@/domain/board';
import { makeBoard, makeCard, makeNote } from '@/state/factories';
import { clearWal, readWal, walHoldsUnsavedWork, writeWal, type WalEntry } from '@/state/wal';
import { migrate } from '../../api/src/domain/migrate.js';
import { parsePutBoardRequest } from '../../api/src/domain/validate.js';

/** IndexedDB stands in as a plain map, so the real `readWal` runs unchanged. */
const disk = vi.hoisted(() => new Map<string, unknown>());

vi.mock('idb-keyval', () => ({
  async get(k: string): Promise<unknown> {
    return disk.get(k);
  },
  async set(k: string, v: unknown): Promise<void> {
    disk.set(k, v);
  },
  async del(k: string): Promise<void> {
    disk.delete(k);
  },
}));

const SERVER_STAMP = '2026-01-01T12:00:30.000Z';
const CLIENT_STAMP = '2026-01-01T11:59:35.000Z'; // this machine runs a minute slow

const server: BoardDoc = {
  ...makeBoard({ title: 'Board', ownerId: 'u1', id: '01BOARD' }),
  nodes: [makeCard({ id: 'A', title: 'A', updatedAt: SERVER_STAMP })],
  updatedAt: SERVER_STAMP,
};

const entry = (doc: BoardDoc, etag: string | null): WalEntry => ({
  boardId: '01BOARD',
  doc,
  savedAt: CLIENT_STAMP,
  etag,
});

describe('walHoldsUnsavedWork', () => {
  it('keeps work whose client stamp is older than the server stamp', () => {
    // The blocker: comparing a browser clock against Azure's threw this away.
    const edited: BoardDoc = {
      ...server,
      nodes: [makeCard({ id: 'A', title: 'A edited', updatedAt: CLIENT_STAMP })],
      updatedAt: CLIENT_STAMP,
    };

    expect(edited.updatedAt < server.updatedAt).toBe(true);
    expect(walHoldsUnsavedWork(entry(edited, '"v1"'), { doc: server, etag: '"v9"' })).toBe(true);
  });

  it('keeps an entry written against the version we just loaded', () => {
    // Same base means no PUT of it can have landed: a 200 moves the ETag on.
    const edited: BoardDoc = { ...server, title: 'Renamed here', updatedAt: CLIENT_STAMP };
    expect(walHoldsUnsavedWork(entry(edited, '"v9"'), { doc: server, etag: '"v9"' })).toBe(true);
  });

  it('keeps an entry from a build that recorded no base', () => {
    const edited: BoardDoc = { ...server, title: 'Renamed here', updatedAt: CLIENT_STAMP };
    expect(walHoldsUnsavedWork(entry(edited, null), { doc: server, etag: '"v9"' })).toBe(true);
  });

  it('drops an entry whose work is already on the server', () => {
    // The delete after a 200 did not land — the server-stamped `updatedAt` and a
    // camera that moved on since are the only differences left.
    const saved: BoardDoc = {
      ...server,
      updatedAt: CLIENT_STAMP,
      viewport: { x: -400, y: 120, zoom: 0.75 },
    };
    expect(walHoldsUnsavedWork(entry(saved, '"v1"'), { doc: server, etag: '"v9"' })).toBe(false);
  });

  it('ignores the fields the PUT handler owns', () => {
    const saved: BoardDoc = {
      ...server,
      createdAt: '2020-01-01T00:00:00.000Z',
      acl: { ownerId: 'u1', editorIds: ['stale'], viewerIds: [] },
    };
    expect(walHoldsUnsavedWork(entry(saved, '"v1"'), { doc: server, etag: '"v9"' })).toBe(false);
  });

  it('sees work anywhere in the document, however deep', () => {
    const deep: BoardDoc = {
      ...server,
      nodes: [
        makeCard({
          id: 'A',
          title: 'A',
          updatedAt: SERVER_STAMP,
          checklist: [{ id: 'c1', text: 'Added offline', done: false, rank: 'a0' }],
        }),
      ],
    };
    expect(walHoldsUnsavedWork(entry(deep, '"v1"'), { doc: server, etag: '"v9"' })).toBe(true);
    expect(walHoldsUnsavedWork(entry({ ...server, labels: [] }, '"v1"'), { doc: server, etag: '"v9"' })).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Across a deploy (spec 7.5)
 * ------------------------------------------------------------------ */

const BOARD_ULID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
const KEY = `wal:${BOARD_ULID}`;

describe('a write-ahead entry written by the deploy before this one', () => {
  /** The work in it, in the shape this build speaks. */
  const work: BoardDoc = {
    ...makeBoard({ title: 'Board', ownerId: 'aad|owner', id: BOARD_ULID }),
    nodes: [
      makeCard({ id: 'A', title: 'Rescued', updatedAt: CLIENT_STAMP }),
      makeNote({ id: 'B', text: 'Written offline' }),
    ],
    updatedAt: CLIENT_STAMP,
  };

  /** The same document as it actually sits on disk: stamped by the old build. */
  const onDisk = { ...work, schemaVersion: 1 };

  beforeEach(() => {
    disk.clear();
    disk.set(KEY, { boardId: BOARD_ULID, doc: onDisk, savedAt: CLIENT_STAMP, etag: '"v0"' });
  });

  it('loads, upgrades, saves and round-trips', async () => {
    const recovered = await readWal(BOARD_ULID);
    expect(recovered).not.toBeNull();
    if (!recovered) return;

    // Upgraded on the way out, and nothing but the version has moved.
    expect(recovered.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(recovered.doc).toEqual(work);

    // ...and the API takes it. This is the whole point of the version being
    // part of what is recovered: a document stamped 1 used to be refused as
    // invalid, and refused again by every autosave after it, so work restored
    // from the log could never be saved again from inside the app.
    const saved = parsePutBoardRequest({ doc: recovered.doc, orphanBlobPaths: [] }, BOARD_ULID);
    expect(saved.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved.doc.nodes).toEqual(work.nodes);
    expect(saved.doc.statuses).toEqual(work.statuses);

    // Stored, read back through the same door the API reads every document
    // through, and offered up again unchanged.
    const readBack = migrate(JSON.parse(JSON.stringify(saved.doc)) as unknown);
    expect(readBack).toEqual(saved.doc);
    expect(parsePutBoardRequest({ doc: readBack }, BOARD_ULID).doc).toEqual(saved.doc);
  });

  it('is not offered back as unsaved work when the server already holds it', async () => {
    // A version bump on its own is not an edit. Reading it as one would greet
    // every user with a leftover entry with a recovery prompt on the first
    // load of the new build — and the button that looks like the safe choice
    // is the one that used to wedge saving.
    const recovered = await readWal(BOARD_ULID);
    expect(recovered).not.toBeNull();
    if (!recovered) return;

    expect(walHoldsUnsavedWork(recovered, { doc: work, etag: '"v9"' })).toBe(false);
    // ...and the entry judged at its stored version answers the same.
    expect(walHoldsUnsavedWork({ ...recovered, doc: onDisk as BoardDoc }, { doc: work, etag: '"v9"' })).toBe(
      false,
    );
  });

  it('still holds on to work the server does not have', async () => {
    const recovered = await readWal(BOARD_ULID);
    expect(recovered).not.toBeNull();
    if (!recovered) return;

    const server: BoardDoc = { ...work, nodes: [work.nodes[0]] }; // the note never landed
    expect(walHoldsUnsavedWork(recovered, { doc: server, etag: '"v9"' })).toBe(true);
  });

  it('leaves an entry from a newer build alone rather than restoring it wrong', async () => {
    disk.set(KEY, {
      boardId: BOARD_ULID,
      doc: { ...work, schemaVersion: SCHEMA_VERSION + 1 },
      savedAt: CLIENT_STAMP,
      etag: null,
    });

    // This bundle cannot know what changed in that version, and a document it
    // guesses at is worse than one it declines to touch.
    expect(await readWal(BOARD_ULID)).toBeNull();
    expect(disk.has(KEY)).toBe(true); // still there for the build that understands it
  });

  it('writes, reads and clears a current entry unchanged', async () => {
    disk.clear();
    await writeWal(BOARD_ULID, work, '"v3"');
    const entry = await readWal(BOARD_ULID);

    expect(entry?.doc).toEqual(work);
    expect(entry?.etag).toBe('"v3"');

    await clearWal(BOARD_ULID);
    expect(await readWal(BOARD_ULID)).toBeNull();
  });
});
