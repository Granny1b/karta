import { describe, expect, it } from 'vitest';
import type { BoardDoc } from '../../../src/domain/board.js';
import { newBoardDoc } from './defaults.js';
import { BadRequestError } from './errors.js';
import { isSafeMediaPath, parsePutBoardRequest } from './validate.js';

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
