import { describe, expect, it } from 'vitest';
import { MAX_SHAPE_LABEL } from '@/domain/board';
import { shouldHintText, capShapeLabel } from '@/canvas/nodes/ShapeNode';
import { makeBoard, makeShape } from '@/state/factories';
import { validateBoardDoc } from '../../../api/src/domain/validate.js';

const BOARD_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

/** The document that reaches the API when someone puts `label` on a shape. */
function boardWithLabel(label: string): unknown {
  return {
    ...makeBoard({ title: 'Board', ownerId: 'aad|owner', id: BOARD_ID }),
    nodes: [makeShape({ shape: 'rectangle', label })],
  };
}

describe('capShapeLabel', () => {
  it('leaves a label the field can hold alone', () => {
    expect(capShapeLabel('')).toBe('');
    expect(capShapeLabel('Ready?')).toBe('Ready?');
    expect(capShapeLabel('x'.repeat(MAX_SHAPE_LABEL))).toHaveLength(MAX_SHAPE_LABEL);
  });

  it('cuts a paste down to what the API stores', () => {
    // `maxLength` on the textarea stops typing, not a programmatic paste.
    expect(capShapeLabel('x'.repeat(5_000))).toHaveLength(MAX_SHAPE_LABEL);
  });

  it('never leaves half of a surrogate pair behind', () => {
    const capped = capShapeLabel(`${'x'.repeat(MAX_SHAPE_LABEL - 1)}🙂`);

    expect(capped).toHaveLength(MAX_SHAPE_LABEL - 1);
    expect([...capped].every((ch) => ch === 'x')).toBe(true);
  });

  it('turns a document the API refuses into one it accepts', () => {
    // The failure this closes: an over-long label is a 400 on every autosave
    // from then on, and nothing on screen says which field is at fault.
    const pasted = 'x'.repeat(MAX_SHAPE_LABEL + 1);

    expect(validateBoardDoc(boardWithLabel(pasted)).errors).toContain(
      `doc.nodes[0].label: longer than ${MAX_SHAPE_LABEL} characters`,
    );
    expect(validateBoardDoc(boardWithLabel(capShapeLabel(pasted))).errors).toEqual([]);
  });
});

describe('the empty-shape text hint', () => {
  const base = { selected: true, sole: true, locked: false, lod: 'full' as const };

  it('shows on the one shape a keystroke would land on', () => {
    expect(shouldHintText(base)).toBe(true);
    expect(shouldHintText({ ...base, lod: 'compact' })).toBe(true);
  });

  it('stays quiet for a shape that is not the whole selection', () => {
    // A marquee over forty shapes must not put a hint in every one of them.
    expect(shouldHintText({ ...base, sole: false })).toBe(false);
    expect(shouldHintText({ ...base, selected: false })).toBe(false);
  });

  it('does not promise typing into a locked shape', () => {
    expect(shouldHintText({ ...base, locked: true })).toBe(false);
  });

  it('stays quiet where the words could not be read', () => {
    expect(shouldHintText({ ...base, lod: 'title' })).toBe(false);
    expect(shouldHintText({ ...base, lod: 'block' })).toBe(false);
  });
});
