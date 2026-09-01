import { describe, expect, it } from 'vitest';
import {
  MAX_CARD_BODY,
  MAX_CHECKLIST_TEXT,
  MAX_EDGE_LABEL,
  MAX_ICON,
  MAX_NAME,
  MAX_NODE_TEXT,
  MAX_SHAPE_LABEL,
  MAX_TITLE,
  type BoardDoc,
} from '@/domain/board';
import { IMPORT_LIMITS, validateImport } from '@/io/schema';
import {
  makeBoard,
  makeCard,
  makeChecklistItem,
  makeEdge,
  makeNote,
  makeShape,
} from '@/state/factories';
import { validateBoardDoc } from '../../api/src/domain/validate.js';

const BOARD_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

const long = (n: number): string => 'x'.repeat(n);

const base = (): BoardDoc => makeBoard({ title: 'Board', ownerId: 'aad|owner', id: BOARD_ID });

/**
 * One number per field, in `src/domain/board.ts`, read by both halves.
 *
 * Three copies of a limit is two copies that can drift, and drift here has a
 * particular cost: a document the API refuses is refused again by every
 * autosave after it, with nothing on screen naming the field at fault. These
 * tests read the API's own refusal message, so a number changed on one side
 * and not the other fails here instead of wedging a board in production.
 */
describe('the length limits, on both sides of the wire', () => {
  it('is the same set of numbers the importer truncates to', () => {
    expect(IMPORT_LIMITS).toEqual({
      title: MAX_TITLE,
      name: MAX_NAME,
      body: MAX_CARD_BODY,
      checklistText: MAX_CHECKLIST_TEXT,
      noteText: MAX_NODE_TEXT,
      edgeLabel: MAX_EDGE_LABEL,
      icon: MAX_ICON,
      shapeLabel: MAX_SHAPE_LABEL,
    });
  });

  it('accepts a document filled to exactly those lengths', () => {
    const doc = base();
    const status = doc.statuses[0];
    const card = makeCard({
      title: long(MAX_TITLE),
      body: long(MAX_CARD_BODY),
      statusId: status ? status.id : null,
      checklist: [makeChecklistItem({ text: long(MAX_CHECKLIST_TEXT) })],
    });
    const note = makeNote({ text: long(MAX_NODE_TEXT) });
    const shape = makeShape({ shape: 'diamond', label: long(MAX_SHAPE_LABEL) });

    const atTheLimit = {
      ...doc,
      title: long(MAX_TITLE),
      icon: long(MAX_ICON),
      statuses: doc.statuses.map((s, i) => (i === 0 ? { ...s, name: long(MAX_NAME) } : s)),
      nodes: [card, note, shape],
      edges: [makeEdge({ source: card.id, target: note.id, label: long(MAX_EDGE_LABEL) })],
    };

    expect(validateBoardDoc(atTheLimit).errors).toEqual([]);
  });

  it('names the same number the client caps by when a field is one over', () => {
    const over = (patch: (doc: BoardDoc) => unknown): string[] =>
      validateBoardDoc(patch(base())).errors;

    expect(over((d) => ({ ...d, title: long(MAX_TITLE + 1) }))).toContain(
      `doc.title: longer than ${MAX_TITLE} characters`,
    );
    expect(over((d) => ({ ...d, icon: long(MAX_ICON + 1) }))).toContain(
      `doc.icon: longer than ${MAX_ICON} characters`,
    );
    expect(
      over((d) => ({
        ...d,
        statuses: d.statuses.map((s, i) => (i === 0 ? { ...s, name: long(MAX_NAME + 1) } : s)),
      })),
    ).toContain(`doc.statuses[0].name: longer than ${MAX_NAME} characters`);
    expect(over((d) => ({ ...d, nodes: [makeCard({ body: long(MAX_CARD_BODY + 1) })] }))).toContain(
      `doc.nodes[0].body: longer than ${MAX_CARD_BODY} characters`,
    );
    expect(
      over((d) => ({
        ...d,
        nodes: [
          makeCard({ checklist: [makeChecklistItem({ text: long(MAX_CHECKLIST_TEXT + 1) })] }),
        ],
      })),
    ).toContain(`doc.nodes[0].checklist[0].text: longer than ${MAX_CHECKLIST_TEXT} characters`);
    expect(over((d) => ({ ...d, nodes: [makeNote({ text: long(MAX_NODE_TEXT + 1) })] }))).toContain(
      `doc.nodes[0].text: longer than ${MAX_NODE_TEXT} characters`,
    );
    expect(
      over((d) => ({
        ...d,
        nodes: [makeShape({ shape: 'diamond', label: long(MAX_SHAPE_LABEL + 1) })],
      })),
    ).toContain(`doc.nodes[0].label: longer than ${MAX_SHAPE_LABEL} characters`);
  });

  it('truncates an import to a length the API then accepts', () => {
    // The importer is the other way a value that is too long reaches a
    // document: a model asked for a note writes an essay.
    const result = validateImport({
      notes: [{ text: long(MAX_NODE_TEXT + 500) }],
      texts: [{ text: long(MAX_NODE_TEXT + 500) }],
      shapes: [{ shape: 'diamond', label: long(MAX_SHAPE_LABEL + 500) }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes?.[0].text).toHaveLength(MAX_NODE_TEXT);
    expect(result.value.texts?.[0].text).toHaveLength(MAX_NODE_TEXT);
    expect(result.value.shapes?.[0].label).toHaveLength(MAX_SHAPE_LABEL);
  });
});
