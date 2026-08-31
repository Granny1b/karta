import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  SHAPE_KINDS,
  isShapeNode,
  isTextNode,
  type BoardDoc,
} from '@/domain/board';
import { makeBoard } from '@/state/factories';
import { applyImport } from '@/io/importer';
import { AI_PROMPT_TEMPLATE, toPortable } from '@/io/exporter';
import { EDGE_SEMANTICS, validateImport } from '@/io/schema';

/**
 * The prompt is a contract with a machine that has never seen the app. Every
 * key it advertises has to be a key the importer reads and the UI can set,
 * because a key the app drops is JSON that silently disappears — the model did
 * as it was told and half the answer never arrives on the board.
 *
 * So the prompt is parsed here and run through the real validator, which is
 * the only way a claim in it can be checked rather than believed.
 */

/** The text between two markers of the prompt, exclusive. */
function block(from: string, to: string): string {
  const start = AI_PROMPT_TEMPLATE.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = AI_PROMPT_TEMPLATE.indexOf(to, start + from.length);
  expect(end).toBeGreaterThan(start);
  return AI_PROMPT_TEMPLATE.slice(start + from.length, end).trim();
}

/** The schema block is annotated for a reader; JSON has no comments. */
const withoutComments = (json: string): string => json.replace(/\s*\/\/.*$/gm, '');

const formatBlock = (): unknown => JSON.parse(withoutComments(block('Format:', '\nRules:')));
const exampleBlock = (): unknown =>
  JSON.parse(withoutComments(block('Example answer:', '\nHere is what I want')));

const board = (): BoardDoc => makeBoard({ title: 'Test', ownerId: 'u1' });

describe('AI_PROMPT_TEMPLATE', () => {
  it('shows a format the importer accepts, with no key it ignores', () => {
    const result = validateImport(formatBlock());

    expect(result.ok).toBe(true);
    // "… is not a Karta field and was ignored" is the exact shape of the
    // failure this guards: a promise in the prompt that the app drops.
    expect(result.warnings.filter((w) => w.includes('is not a Karta field'))).toEqual([]);
  });

  it('shows an example answer the importer accepts', () => {
    const result = validateImport(exampleBlock());

    expect(result.ok).toBe(true);
    expect(result.warnings.filter((w) => w.includes('is not a Karta field'))).toEqual([]);
  });

  it('names every shape this build draws, and only those', () => {
    const listed = block('- "shape" is one of:', '\n- ')
      .split(/[,\n]/)
      .map((word) => word.trim().replace(/\.$/, ''))
      .filter((word) => word.length > 0);

    expect(listed).toEqual([...SHAPE_KINDS]);
  });

  it('names every arrow semantic this build understands', () => {
    const listed = block('- "semantic" is one of:', '. Default')
      .split(',')
      .map((word) => word.trim());

    expect(listed).toEqual([...EDGE_SEMANTICS]);
  });

  it('states the font-size bounds the API actually enforces', () => {
    expect(AI_PROMPT_TEMPLATE).toContain(`"fontSize" is ${MIN_TEXT_SIZE} to ${MAX_TEXT_SIZE}`);
  });

  it('promises nothing about a text or a shape the board cannot hand back', () => {
    // Round trip: what the prompt tells a model to write, imported and then
    // exported again. Anything the app cannot carry disappears here.
    const input = validateImport(formatBlock());
    expect(input.ok).toBe(true);
    if (!input.ok) return;

    const { doc } = applyImport(board(), input.value, 'u1', 'merge');
    const text = doc.nodes.find(isTextNode);
    const shape = doc.nodes.find(isShapeNode);

    expect(text).toBeDefined();
    expect(shape).toBeDefined();
    if (!text || !shape) return;

    expect({ fontSize: text.fontSize, align: text.align, weight: text.weight }).toEqual({
      fontSize: 32,
      align: 'left',
      weight: 'bold',
    });
    expect({ shape: shape.shape, label: shape.label, fill: shape.fill, stroke: shape.stroke }).toEqual({
      shape: 'diamond',
      label: 'Ready?',
      fill: 'blue',
      stroke: 'slate',
    });

    const portable = toPortable(doc);
    expect(portable.texts?.[0]).toMatchObject({ fontSize: 32, weight: 'bold' });
    expect(portable.shapes?.[0]).toMatchObject({ shape: 'diamond', fill: 'blue', stroke: 'slate' });
  });

  it('carries the arrow from the example onto the board', () => {
    // "from" and "to" resolve by key or by card title, which is the one rule
    // in the prompt a model cannot check for itself.
    const input = validateImport(exampleBlock());
    expect(input.ok).toBe(true);
    if (!input.ok) return;

    const { doc, summary } = applyImport(board(), input.value, 'u1', 'merge');

    expect(summary.edges).toBe(1);
    expect(summary.warnings).toEqual([]);
    expect(doc.edges[0]?.semantic).toBe('depends');
  });
});
