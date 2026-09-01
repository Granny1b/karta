import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_SIZE,
  MAX_NODE_TEXT,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  capNodeText,
  capText,
} from '@/domain/board';
import { TEXT_SIZE_STEPS, clampTextSize, stepTextSize } from '@/canvas/nodes/TextNode';
import { makeBoard, makeText } from '@/state/factories';
import { validateBoardDoc } from '../../../api/src/domain/validate.js';

const BOARD_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

const long = (n: number): string => 'x'.repeat(n);

/** The document that reaches the API when a text node is set to `fontSize`. */
function boardWithSize(fontSize: number): unknown {
  return {
    ...makeBoard({ title: 'Board', ownerId: 'aad|owner', id: BOARD_ID }),
    nodes: [makeText({ text: 'Heading', fontSize })],
  };
}

/** The document that reaches the API when someone writes `text` on the board. */
function boardWithText(text: string): unknown {
  return {
    ...makeBoard({ title: 'Board', ownerId: 'aad|owner', id: BOARD_ID }),
    nodes: [makeText({ text })],
  };
}

describe('capText', () => {
  it('leaves a value inside the cap alone', () => {
    expect(capText('', 10)).toBe('');
    expect(capText('short', 10)).toBe('short');
    expect(capText(long(10), 10)).toHaveLength(10);
  });

  it('cuts what is over the cap', () => {
    expect(capText(long(11), 10)).toBe(long(10));
    expect(capText(long(5_000), 10)).toBe(long(10));
  });

  it('never leaves half of a surrogate pair behind', () => {
    // A cut between the halves of an emoji leaves a lone surrogate: a
    // character no font draws, and one a JSON round trip turns into U+FFFD.
    const capped = capText(`${long(9)}🙂`, 10);

    expect(capped).toHaveLength(9);
    expect([...capped].every((ch) => ch === 'x')).toBe(true);
  });

  it('keeps a pair that ends exactly on the cap', () => {
    expect(capText(`${long(8)}🙂`, 10)).toHaveLength(10);
  });
});

describe('capNodeText', () => {
  it('leaves a body the field can hold alone', () => {
    expect(capNodeText('')).toBe('');
    expect(capNodeText('A heading')).toBe('A heading');
    expect(capNodeText(long(MAX_NODE_TEXT))).toHaveLength(MAX_NODE_TEXT);
  });

  it('cuts a paste down to what the API stores', () => {
    // `maxLength` on the textarea stops typing, not a programmatic paste.
    expect(capNodeText(long(MAX_NODE_TEXT + 1))).toHaveLength(MAX_NODE_TEXT);
    expect(capNodeText(long(MAX_NODE_TEXT * 3))).toHaveLength(MAX_NODE_TEXT);
  });

  it('turns a document the API refuses into one it accepts', () => {
    // The failure this closes: a body one character over the cap is a 400 on
    // every autosave from then on, and nothing on screen says which field is
    // at fault. The shape label had this hole; the text node had it too.
    const pasted = long(MAX_NODE_TEXT + 1);

    expect(validateBoardDoc(boardWithText(pasted)).errors).toContain(
      `doc.nodes[0].text: longer than ${MAX_NODE_TEXT} characters`,
    );
    expect(validateBoardDoc(boardWithText(capNodeText(pasted))).errors).toEqual([]);
  });
});

describe('the size ladder', () => {
  it('starts and ends exactly at the bounds the API enforces', () => {
    expect(TEXT_SIZE_STEPS[0]).toBe(MIN_TEXT_SIZE);
    expect(TEXT_SIZE_STEPS[TEXT_SIZE_STEPS.length - 1]).toBe(MAX_TEXT_SIZE);
  });

  it('climbs', () => {
    const sorted = [...TEXT_SIZE_STEPS].sort((a, b) => a - b);
    expect(TEXT_SIZE_STEPS).toEqual(sorted);
    expect(new Set(TEXT_SIZE_STEPS).size).toBe(TEXT_SIZE_STEPS.length);
  });

  it('holds no size the API would refuse', () => {
    // The point of the ladder: a control that cannot reach a document that
    // cannot be saved. `fontSize` outside 8–200 is a 400 on every autosave.
    for (const size of TEXT_SIZE_STEPS) {
      expect(validateBoardDoc(boardWithSize(size)).errors).toEqual([]);
    }
    expect(validateBoardDoc(boardWithSize(MAX_TEXT_SIZE + 1)).errors).toContain(
      `doc.nodes[0].fontSize: expected a number between ${MIN_TEXT_SIZE} and ${MAX_TEXT_SIZE}`,
    );
  });
});

describe('clampTextSize', () => {
  it('leaves a size inside the bounds alone', () => {
    expect(clampTextSize(MIN_TEXT_SIZE)).toBe(MIN_TEXT_SIZE);
    expect(clampTextSize(DEFAULT_TEXT_SIZE)).toBe(DEFAULT_TEXT_SIZE);
    expect(clampTextSize(MAX_TEXT_SIZE)).toBe(MAX_TEXT_SIZE);
  });

  it('pulls an imported size back inside them', () => {
    expect(clampTextSize(0)).toBe(MIN_TEXT_SIZE);
    expect(clampTextSize(-40)).toBe(MIN_TEXT_SIZE);
    expect(clampTextSize(1e6)).toBe(MAX_TEXT_SIZE);
  });

  it('falls back to the default for a size that is not a number at all', () => {
    expect(clampTextSize(Number.NaN)).toBe(DEFAULT_TEXT_SIZE);
    expect(clampTextSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TEXT_SIZE);
  });

  it('leaves a fractional size as it is — the API takes one', () => {
    expect(clampTextSize(24.5)).toBe(24.5);
  });
});

describe('stepTextSize', () => {
  it('walks the ladder one rung at a time', () => {
    expect(stepTextSize(20, 1)).toBe(24);
    expect(stepTextSize(20, -1)).toBe(16);
    expect(stepTextSize(MIN_TEXT_SIZE, 1)).toBe(TEXT_SIZE_STEPS[1]);
  });

  it('stops at the ends rather than stepping out of what the API accepts', () => {
    expect(stepTextSize(MAX_TEXT_SIZE, 1)).toBe(MAX_TEXT_SIZE);
    expect(stepTextSize(MIN_TEXT_SIZE, -1)).toBe(MIN_TEXT_SIZE);
    expect(stepTextSize(1e6, 1)).toBe(MAX_TEXT_SIZE);
    expect(stepTextSize(-1, -1)).toBe(MIN_TEXT_SIZE);
  });

  it('moves a size that is not on the ladder to the next rung in that direction', () => {
    // 37 px is a perfectly legal imported size; the stepper must not snap it
    // backwards to reach 40, nor jump the whole ladder to reach 32.
    expect(stepTextSize(37, 1)).toBe(40);
    expect(stepTextSize(37, -1)).toBe(32);
    // And a size a hair above a rung steps down onto that rung, not past it.
    expect(stepTextSize(24.5, -1)).toBe(24);
    expect(stepTextSize(24.5, 1)).toBe(32);
  });

  it('never leaves the bounds, from any starting point', () => {
    for (const start of [-1e6, 0, 7, 8, 19, 200, 201, 1e6]) {
      for (const direction of [1, -1] as const) {
        const next = stepTextSize(start, direction);
        expect(next).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
        expect(next).toBeLessThanOrEqual(MAX_TEXT_SIZE);
      }
    }
  });
});
