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

    expect(SCHEMA_VERSION).toBe(2);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    // 1 -> 2 only added node kinds, so nothing already stored changes shape.
    expect(doc.nodes).toEqual(before.nodes);
    expect(doc.id).toBe(BOARD_ID);
    expect(doc.statuses).toEqual(before.statuses);
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
