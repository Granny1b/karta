import { describe, expect, it } from 'vitest';
import type { BoardDoc } from '@/domain/board';
import { makeBoard, makeCard } from '@/state/factories';
import { walHoldsUnsavedWork, type WalEntry } from '@/state/wal';

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
