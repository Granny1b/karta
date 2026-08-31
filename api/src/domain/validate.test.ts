import { describe, expect, it } from 'vitest';
import type { BoardDoc } from '../../../src/domain/board.js';
import { newBoardDoc } from './defaults.js';
import { BadRequestError } from './errors.js';
import { isSafeMediaPath, parsePutBoardRequest, validateBoardDoc } from './validate.js';

const BOARD_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
const OTHER_BOARD_ID = '01HYYYYYYYYYYYYYYYYYYYYYYY';
const MEDIA_ID = '01HXXXXXXXXXXXXXXXXXXXXXXX';

function doc(): BoardDoc {
  return { ...newBoardDoc('Tavla', null, 'aad|owner'), id: BOARD_ID };
}

function put(orphanBlobPaths: unknown): unknown {
  return { doc: doc(), orphanBlobPaths };
}

describe('isSafeMediaPath', () => {
  it('accepts a blob of the board being written', () => {
    expect(isSafeMediaPath(`media/${BOARD_ID}/${MEDIA_ID}.webp`, BOARD_ID)).toBe(true);
    expect(isSafeMediaPath(`media/${BOARD_ID}/${MEDIA_ID}.thumb.webp`, BOARD_ID)).toBe(true);
  });

  it('rejects a blob owned by another board', () => {
    expect(isSafeMediaPath(`media/${OTHER_BOARD_ID}/${MEDIA_ID}.webp`, BOARD_ID)).toBe(false);
  });
});

describe('parsePutBoardRequest orphanBlobPaths', () => {
  it('keeps paths that belong to the board being written', () => {
    const paths = [`media/${BOARD_ID}/${MEDIA_ID}.webp`, `media/${BOARD_ID}/${MEDIA_ID}.thumb.webp`];
    expect(parsePutBoardRequest(put(paths), BOARD_ID).orphanBlobPaths).toEqual(paths);
  });

  it('drops a path owned by another board instead of failing the save', () => {
    // "Extract to board" and "save a copy" hand the new document the parent's
    // MediaRefs verbatim, so deleting such an image queues a foreign path.
    // Rejecting the write would wedge the board: the client only clears its
    // orphan queue on success, so every later autosave would repeat the 400.
    const mine = `media/${BOARD_ID}/${MEDIA_ID}.webp`;
    const theirs = `media/${OTHER_BOARD_ID}/${MEDIA_ID}.webp`;

    const parsed = parsePutBoardRequest(put([theirs, mine]), BOARD_ID);

    expect(parsed.orphanBlobPaths).toEqual([mine]);
  });

  it('drops entries that are not media blob paths at all', () => {
    const junk = [null, 42, '', '../../boards/other.json', `media/${BOARD_ID}/nope.webp`];
    expect(parsePutBoardRequest(put(junk), BOARD_ID).orphanBlobPaths).toEqual([]);
  });

  it('treats a missing or null list as empty', () => {
    expect(parsePutBoardRequest({ doc: doc() }, BOARD_ID).orphanBlobPaths).toEqual([]);
    expect(parsePutBoardRequest(put(null), BOARD_ID).orphanBlobPaths).toEqual([]);
  });

  it('still rejects a list that is not an array', () => {
    expect(() => parsePutBoardRequest(put('media/x'), BOARD_ID)).toThrow(BadRequestError);
  });

  it('still rejects a list longer than the cap', () => {
    const many = Array.from({ length: 501 }, () => `media/${BOARD_ID}/${MEDIA_ID}.webp`);
    expect(() => parsePutBoardRequest(put(many), BOARD_ID)).toThrow(BadRequestError);
  });
});

/* ------------------------------------------------------------------ *
 * The node kinds added in schema version 2
 * ------------------------------------------------------------------ */

const NODE_BASE = {
  id: 'n1',
  position: { x: 0, y: 0 },
  size: { w: 240, h: 48 },
  z: 0,
  color: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'aad|owner',
  locked: false,
};

const TEXT_NODE = {
  ...NODE_BASE,
  kind: 'text',
  text: 'Phase one',
  fontSize: 20,
  align: 'left',
  weight: 'regular',
};

const SHAPE_NODE = {
  ...NODE_BASE,
  kind: 'shape',
  shape: 'diamond',
  label: 'Ready?',
  fill: 'blue',
  stroke: null,
};

/** The errors reported for a document holding exactly this one node. */
function nodeErrors(node: Record<string, unknown>): string[] {
  const result = validateBoardDoc({ ...doc(), nodes: [node] });
  return result.errors;
}

describe('validateBoardDoc node kinds', () => {
  it('accepts a text node and a shape node', () => {
    expect(nodeErrors(TEXT_NODE)).toEqual([]);
    expect(nodeErrors(SHAPE_NODE)).toEqual([]);
    expect(nodeErrors({ ...SHAPE_NODE, fill: null, stroke: '#ab12cd' })).toEqual([]);
  });

  it('holds a text node to its own fields', () => {
    expect(nodeErrors({ ...TEXT_NODE, text: 42 })).toContain('doc.nodes[0].text: expected a string');
    expect(nodeErrors({ ...TEXT_NODE, fontSize: 0 })).toContain(
      'doc.nodes[0].fontSize: expected a number between 8 and 200',
    );
    expect(nodeErrors({ ...TEXT_NODE, fontSize: Number.POSITIVE_INFINITY })).toHaveLength(1);
    expect(nodeErrors({ ...TEXT_NODE, align: 'justified' })).toContain(
      'doc.nodes[0].align: expected one of left, center, right',
    );
    expect(nodeErrors({ ...TEXT_NODE, weight: 'heavy' })).toContain(
      'doc.nodes[0].weight: expected one of regular, bold',
    );
  });

  it('holds a shape node to its own fields', () => {
    expect(nodeErrors({ ...SHAPE_NODE, shape: 'octagon' })[0]).toMatch(/^doc\.nodes\[0\]\.shape: /);
    expect(nodeErrors({ ...SHAPE_NODE, label: null })).toContain(
      'doc.nodes[0].label: expected a string',
    );
    // Shorthand hex is the one shape a document may not carry — the same rule
    // every other colour field goes through, and the same helper.
    expect(nodeErrors({ ...SHAPE_NODE, fill: '#f00' })).toContain(
      'doc.nodes[0].fill: expected a colour token or #RRGGBB',
    );
    expect(nodeErrors({ ...SHAPE_NODE, stroke: 'neon' })).toContain(
      'doc.nodes[0].stroke: expected a colour token or #RRGGBB',
    );
  });

  it('still rejects a kind it has never heard of', () => {
    expect(nodeErrors({ ...NODE_BASE, kind: 'sticker' })).toContain(
      'doc.nodes[0].kind: expected one of card, image, note, boardLink, group, text, shape',
    );
  });
});
