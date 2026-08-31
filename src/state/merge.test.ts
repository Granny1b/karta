import { describe, expect, it } from 'vitest';
import type { BoardDoc, CardNode } from '@/domain/board';
import { makeBoard, makeCard, makeEdge, makeNote } from '@/state/factories';
import { mergeBoards } from '@/state/merge';

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';

const cardA = makeCard({ id: 'A', title: 'A', updatedAt: T1 });
const cardB = makeCard({ id: 'B', title: 'B', updatedAt: T1 });

const base: BoardDoc = {
  ...makeBoard({ title: 'Board', ownerId: 'u1', id: '01BOARD' }),
  nodes: [cardA, cardB],
  edges: [makeEdge({ id: 'E', source: 'A', target: 'B', updatedAt: T1 })],
  updatedAt: T1,
};

const titleOf = (doc: BoardDoc, id: string): string => (doc.nodes.find((n) => n.id === id) as CardNode).title;

describe('mergeBoards', () => {
  it('takes the later node, keeps local additions and drops dangling edges', () => {
    const local: BoardDoc = {
      ...base,
      nodes: [{ ...cardA, title: 'A local', updatedAt: T2 }, cardB, makeNote({ id: 'NEW', text: 'added here' })],
      updatedAt: T2,
    };
    const server: BoardDoc = {
      ...base,
      nodes: [{ ...cardA, title: 'A server', updatedAt: T3 }],
      title: 'Renamed',
      updatedAt: T3,
    };

    const { doc, notes } = mergeBoards(base, local, server);

    expect(doc.nodes.map((n) => n.id).sort()).toEqual(['A', 'NEW']);
    expect(titleOf(doc, 'A')).toBe('A server'); // later updatedAt wins, whole node
    expect(doc.edges).toHaveLength(0); // B is gone, so the arrow goes with it
    expect(doc.title).toBe('Renamed');
    expect(doc.viewport).toEqual(local.viewport); // the camera stays local
    expect(notes.some((n) => n.includes('arrow'))).toBe(true);
  });

  it('keeps a locally edited node that the server deleted', () => {
    const local: BoardDoc = {
      ...base,
      nodes: [cardA, { ...cardB, title: 'B edited', updatedAt: T3 }],
      updatedAt: T3,
    };
    const server: BoardDoc = { ...base, nodes: [cardA], updatedAt: T2 };

    const { doc, notes } = mergeBoards(base, local, server);

    expect(doc.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
    expect(doc.edges).toHaveLength(1);
    expect(notes.some((n) => n.includes('deleted elsewhere'))).toBe(true);
  });

  it('keeps a remotely edited node that this client deleted, and unions the definitions', () => {
    const local: BoardDoc = {
      ...base,
      nodes: [cardA],
      labels: [{ id: 'L1', name: 'Local label', color: 'straw' }],
      updatedAt: T2,
    };
    const server: BoardDoc = {
      ...base,
      nodes: [cardA, { ...cardB, title: 'B elsewhere', updatedAt: T3 }],
      labels: [{ id: 'L2', name: 'Server label', color: 'blue' }],
      updatedAt: T3,
    };

    const { doc, notes } = mergeBoards(base, local, server);

    expect(titleOf(doc, 'B')).toBe('B elsewhere');
    expect(doc.labels.map((l) => l.id).sort()).toEqual(['L1', 'L2']);
    expect(doc.statuses.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
    expect(notes.some((n) => n.includes('was edited elsewhere'))).toBe(true);
  });

  it('accepts a remote delete of a node nobody touched', () => {
    const local: BoardDoc = { ...base, updatedAt: T2 };
    const server: BoardDoc = { ...base, nodes: [cardA], edges: [], updatedAt: T3 };

    const { doc } = mergeBoards(base, local, server);

    expect(doc.nodes.map((n) => n.id)).toEqual(['A']);
    expect(doc.edges).toHaveLength(0);
  });
});
