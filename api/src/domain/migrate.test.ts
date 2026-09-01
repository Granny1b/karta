import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../../../src/domain/board.js';
import { newBoardDoc } from './defaults.js';
import { migrate, upgradeToCurrent } from './migrate.js';

const BOARD_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

/** A stored document as some earlier deploy wrote it. */
function stored(version: number): Record<string, unknown> {
  return {
    ...newBoardDoc('Tavla', null, 'aad|owner'),
    id: BOARD_ID,
    schemaVersion: version,
    nodes: [
      {
        id: 'n1',
        kind: 'note',
        position: { x: 10, y: 20 },
        size: { w: 200, h: 160 },
        z: 0,
        color: 'straw',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        updatedBy: 'aad|owner',
        locked: false,
        text: 'Written under version 1',
      },
    ],
  };
}

describe('migrate', () => {
  it('accepts a version 1 document and stamps it as the current version', () => {
    const before = stored(1);
    const doc = migrate(before);

    // Deliberately not pinned to a literal: this asserts the walk reaches the
    // current version, whatever that is, so adding a step does not fail here.
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    // No step so far rewrites a node, so everything stored keeps its shape.
    expect(doc.nodes).toEqual(before.nodes);
    expect(doc.id).toBe(BOARD_ID);
  });

  it('passes a current document through untouched', () => {
    const before = stored(SCHEMA_VERSION);
    expect(migrate(before)).toEqual({ ...before, schemaVersion: SCHEMA_VERSION });
  });

  it('refuses a document from a future deploy rather than guessing', () => {
    expect(() => migrate(stored(SCHEMA_VERSION + 1))).toThrow(/Deploy the newer API/);
  });

  it('refuses a document with no usable version at all', () => {
    expect(() => migrate({ ...stored(1), schemaVersion: 'two' })).toThrow(/invalid schemaVersion/);
    expect(() => migrate('not a document')).toThrow(/not a JSON object/);
  });
});

describe('upgradeToCurrent', () => {
  it('walks a document forward and stamps it, without filling anything in', () => {
    // The write path judges what this returns, so it must not invent the
    // fields a client left out — `normalise` may, `upgradeToCurrent` may not.
    expect(upgradeToCurrent({ schemaVersion: 1, id: BOARD_ID })).toEqual({
      schemaVersion: SCHEMA_VERSION,
      id: BOARD_ID,
    });
  });

  it('leaves the document it was handed alone', () => {
    const before = stored(1);
    upgradeToCurrent(before);
    expect(before['schemaVersion']).toBe(1);
  });

  it('refuses the same versions the read path refuses', () => {
    expect(() => upgradeToCurrent(stored(SCHEMA_VERSION + 1))).toThrow(/Deploy the newer API/);
    expect(() => upgradeToCurrent({ ...stored(1), schemaVersion: 0 })).toThrow(/invalid schemaVersion/);
    expect(() => upgradeToCurrent({})).toThrow(/invalid schemaVersion/);
  });
});

describe('2 -> 3: English default statuses', () => {
  const v2Board = (statuses: Array<{ name: string; id?: string; isDone?: boolean }>): unknown => ({
    schemaVersion: 2,
    id: '01J0000000000000000000000A',
    parentBoardId: null,
    title: 'Systems',
    icon: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    acl: { ownerId: 'u1', editorIds: [], viewerIds: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
    statuses: statuses.map((s, i) => ({
      id: s.id ?? `S${i}`,
      name: s.name,
      color: 'slate',
      order: i,
      isDone: s.isDone ?? false,
    })),
    labels: [],
    nodes: [],
    edges: [],
    media: [],
  });

  it('renames a board still carrying the Swedish defaults', () => {
    const doc = migrate(
      v2Board([
        { name: 'Idé' },
        { name: 'Planerad' },
        { name: 'Bygger' },
        { name: 'Testar' },
        { name: 'Klar', isDone: true },
      ]),
    );

    expect(doc.statuses.map((s) => s.name)).toEqual([
      'Idea',
      'Planned',
      'Building',
      'Testing',
      'Done',
    ]);
    expect(doc.schemaVersion).toBe(3);
  });

  it('keeps ids, order, colour and isDone, so cards do not change column', () => {
    const before = v2Board([{ name: 'Bygger', id: 'KEEP' }, { name: 'Klar', id: 'END', isDone: true }]);
    const doc = migrate(before);

    expect(doc.statuses.map((s) => s.id)).toEqual(['KEEP', 'END']);
    expect(doc.statuses.map((s) => s.order)).toEqual([0, 1]);
    expect(doc.statuses[1]?.isDone).toBe(true);
  });

  it('leaves a status the owner already renamed alone', () => {
    // Only an exact match of an original default is touched. Anything the owner
    // chose is theirs, in any language.
    const doc = migrate(v2Board([{ name: 'Blockerad' }, { name: 'Idé' }, { name: 'Shipped' }]));
    expect(doc.statuses.map((s) => s.name)).toEqual(['Blockerad', 'Idea', 'Shipped']);
  });

  it('carries a v1 document all the way to English', () => {
    const raw = v2Board([{ name: 'Klar', isDone: true }]) as Record<string, unknown>;
    raw['schemaVersion'] = 1;
    const doc = migrate(raw);
    expect(doc.schemaVersion).toBe(3);
    expect(doc.statuses[0]?.name).toBe('Done');
  });
});
