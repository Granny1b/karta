import { describe, expect, it } from 'vitest';
import type { BoardDoc, MediaRef } from '@/domain/board';
import {
  makeBoard,
  makeCard,
  makeChecklistItem,
  makeEdge,
  makeImageNode,
  makeLabel,
  makeStatus,
} from '@/state/factories';
import type { ClipboardPayload } from '@/canvas/clipboard';
import { duplicateNodes, nextCollapsed, offsetToCentre, pasteNodes } from '@/canvas/ops';

function media(id: string): MediaRef {
  return {
    id,
    blobPath: `media/b/${id}.webp`,
    thumbPath: `media/b/${id}.thumb.webp`,
    contentType: 'image/webp',
    bytes: 128,
    width: 40,
    height: 30,
    uploadedAt: '2026-01-01T00:00:00.000Z',
    uploadedBy: 'u',
  };
}

function emptyBoard(): BoardDoc {
  const doc = makeBoard({ title: 'Target', ownerId: 'u', statuses: [] });
  doc.labels = [];
  doc.nodes = [];
  doc.edges = [];
  doc.media = [];
  return doc;
}

describe('duplicateNodes', () => {
  it('mints fresh ids for the copies, their checklists and the edges between them', () => {
    const doc = emptyBoard();
    const a = makeCard({ id: 'A', title: 'One', checklist: [makeChecklistItem({ id: 'I1', text: 'step' })] });
    const b = makeCard({ id: 'B', title: 'Two' });
    doc.nodes = [a, b];
    doc.edges = [makeEdge({ id: 'E', source: 'A', target: 'B' })];

    const copy = duplicateNodes(doc, ['A', 'B'], 'me');

    expect(copy.nodes).toHaveLength(2);
    expect(copy.nodes.map((n) => n.id)).not.toContain('A');
    expect(copy.nodes.every((n) => n.updatedBy === 'me')).toBe(true);
    const card = copy.nodes[0];
    if (!card || card.kind !== 'card') throw new Error('expected a card');
    expect(card.checklist[0]?.id).not.toBe('I1');
    expect(card.checklist[0]?.text).toBe('step');
    expect(card.position).toEqual({ x: 24, y: 24 });

    expect(copy.edges).toHaveLength(1);
    expect(copy.edges[0]?.source).toBe(copy.idMap.get('A'));
    expect(copy.edges[0]?.target).toBe(copy.idMap.get('B'));
  });

  it('keeps the references that still resolve on the same board', () => {
    const doc = emptyBoard();
    const status = makeStatus({ id: 'S', name: 'Bygger' });
    const label = makeLabel({ id: 'L', name: 'Net' });
    doc.statuses = [status];
    doc.labels = [label];
    doc.media = [media('M')];
    doc.nodes = [makeCard({ id: 'A', statusId: 'S', labelIds: ['L'], coverMediaId: 'M' })];

    const card = duplicateNodes(doc, ['A'], 'me').nodes[0];
    if (!card || card.kind !== 'card') throw new Error('expected a card');
    expect(card.statusId).toBe('S');
    expect(card.labelIds).toEqual(['L']);
    expect(card.coverMediaId).toBe('M');
  });
});

describe('pasteNodes', () => {
  it('drops the references the receiving board does not have', () => {
    const source = emptyBoard();
    source.statuses = [makeStatus({ id: 'S-other', name: 'Elsewhere' })];
    source.labels = [makeLabel({ id: 'L-other', name: 'Elsewhere' })];
    source.media = [media('M-other')];
    const card = makeCard({
      id: 'A',
      statusId: 'S-other',
      labelIds: ['L-other'],
      coverMediaId: 'M-other',
    });
    const payload: ClipboardPayload = { boardId: source.id, nodes: [card], edges: [] };

    const target = emptyBoard();
    target.statuses = [makeStatus({ id: 'S-here', name: 'Here' })];

    const paste = pasteNodes(target, payload, 'me', { x: 0, y: 0 });
    const pasted = paste.nodes[0];
    if (!pasted || pasted.kind !== 'card') throw new Error('expected a card');
    expect(pasted.statusId).toBeNull();
    expect(pasted.labelIds).toEqual([]);
    expect(pasted.coverMediaId).toBeNull();
    expect(paste.skipped).toBe(0);
  });

  it('leaves behind an image whose file lives on another board, and its edges', () => {
    const image = makeImageNode({ id: 'IMG', mediaId: 'M-other', naturalSize: { w: 40, h: 30 } });
    const card = makeCard({ id: 'A' });
    const payload: ClipboardPayload = {
      boardId: 'other-board',
      nodes: [card, image],
      edges: [makeEdge({ id: 'E', source: 'A', target: 'IMG' })],
    };

    const paste = pasteNodes(emptyBoard(), payload, 'me', { x: 0, y: 0 });
    expect(paste.nodes).toHaveLength(1);
    expect(paste.nodes[0]?.kind).toBe('card');
    expect(paste.edges).toHaveLength(0);
    expect(paste.skipped).toBe(1);
  });

  it('keeps an image whose media travelled with the board', () => {
    const target = emptyBoard();
    target.media = [media('M')];
    const payload: ClipboardPayload = {
      boardId: target.id,
      nodes: [makeImageNode({ id: 'IMG', mediaId: 'M', naturalSize: { w: 40, h: 30 } })],
      edges: [],
    };

    const paste = pasteNodes(target, payload, 'me', { x: 8, y: 8 });
    expect(paste.nodes).toHaveLength(1);
    expect(paste.skipped).toBe(0);
  });
});

describe('offsetToCentre', () => {
  it('puts the middle of the copied cluster under the cursor, on the grid', () => {
    const nodes = [
      makeCard({ id: 'A', position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }),
      makeCard({ id: 'B', position: { x: 100, y: 100 }, size: { w: 100, h: 100 } }),
    ];
    // The cluster is 200x200 at the origin, so its centre is (100, 100).
    expect(offsetToCentre(nodes, { x: 300, y: 300 })).toEqual({ x: 200, y: 200 });
    expect(offsetToCentre(nodes, { x: 303, y: 297 }, 8)).toEqual({ x: 200, y: 200 });
  });

  it('is a no-op when there is nothing to place', () => {
    expect(offsetToCentre([], { x: 40, y: 40 }, 8)).toEqual({ x: 0, y: 0 });
  });
});

describe('nextCollapsed', () => {
  it('opens a selection that is collapsed throughout and collapses anything else', () => {
    const open = makeCard({ id: 'A' });
    const shut = makeCard({ id: 'B', collapsed: true });
    expect(nextCollapsed([shut])).toBe(false);
    expect(nextCollapsed([open])).toBe(true);
    expect(nextCollapsed([open, shut])).toBe(true);
  });
});
