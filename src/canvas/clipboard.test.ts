import { beforeEach, describe, expect, it } from 'vitest';
import { makeBoard, makeCard, makeEdge, makeNote } from '@/state/factories';
import {
  clipboardMarker,
  collectForClipboard,
  forgetClipboard,
  holdForClipboard,
  markerToken,
  payloadForMarker,
} from '@/canvas/clipboard';

function board() {
  const doc = makeBoard({ title: 'Board', ownerId: 'u' });
  const a = makeCard({ id: 'A', title: 'One' });
  const b = makeCard({ id: 'B', title: 'Two' });
  const c = makeNote({ id: 'C', text: 'Outside' });
  doc.nodes = [a, b, c];
  doc.edges = [
    makeEdge({ id: 'E-inside', source: 'A', target: 'B' }),
    makeEdge({ id: 'E-crossing', source: 'B', target: 'C' }),
  ];
  return doc;
}

describe('collectForClipboard', () => {
  beforeEach(() => forgetClipboard());

  it('takes the nodes and only the edges that ran between them', () => {
    const payload = collectForClipboard(board(), ['A', 'B']);
    expect(payload?.nodes.map((n) => n.id)).toEqual(['A', 'B']);
    expect(payload?.edges.map((e) => e.id)).toEqual(['E-inside']);
  });

  it('is nothing when nothing is selected', () => {
    expect(collectForClipboard(board(), [])).toBeNull();
    expect(collectForClipboard(board(), ['missing'])).toBeNull();
  });
});

describe('the clipboard marker', () => {
  beforeEach(() => forgetClipboard());

  it('reads back the payload it was given', () => {
    const payload = collectForClipboard(board(), ['A']);
    if (!payload) throw new Error('expected a payload');
    const text = holdForClipboard(payload);
    expect(markerToken(text)).not.toBeNull();
    expect(payloadForMarker(text)).toBe(payload);
    // Browsers hand back the text with the trailing newline some apps add.
    expect(payloadForMarker(`${text}\n`)).toBe(payload);
  });

  it('ignores anything the user copied in between', () => {
    const payload = collectForClipboard(board(), ['A']);
    if (!payload) throw new Error('expected a payload');
    holdForClipboard(payload);

    expect(payloadForMarker('some text from another app')).toBeNull();
    expect(payloadForMarker(clipboardMarker('01OTHERTOKEN'))).toBeNull();
    expect(payloadForMarker(null)).toBeNull();
    expect(markerToken('karta/nodes:')).toBeNull();
  });

  it('holds only the most recent copy', () => {
    const doc = board();
    const first = collectForClipboard(doc, ['A']);
    const second = collectForClipboard(doc, ['B']);
    if (!first || !second) throw new Error('expected payloads');

    const firstText = holdForClipboard(first);
    const secondText = holdForClipboard(second);
    expect(payloadForMarker(firstText)).toBeNull();
    expect(payloadForMarker(secondText)).toBe(second);
  });
});
