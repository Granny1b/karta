import { describe, expect, it } from 'vitest';
import { isCardNode, type BoardDoc } from '@/domain/board';
import { makeBoard } from '@/state/factories';
import { applyImport } from '@/io/importer';
import { exportPortable, toPortable } from '@/io/exporter';
import { validateImport } from '@/io/schema';

const board = (): BoardDoc => makeBoard({ title: 'Test', ownerId: 'u1' });

const validated = (raw: unknown) => {
  const result = validateImport(raw);
  if (!result.ok) throw new Error(`expected valid input, got: ${result.errors.join(' / ')}`);
  return result;
};

describe('validateImport', () => {
  it('accepts a bare array of cards', () => {
    const result = validated([{ title: 'One' }, { title: 'Two' }]);
    expect(result.value.cards?.map((c) => c.title)).toEqual(['One', 'Two']);
  });

  it('names the exact path of every problem', () => {
    const result = validateImport({ cards: [{ title: 'ok' }, { body: 'no title' }, { title: 42 }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('cards[1].title is required.');
    expect(result.errors).toContain('cards[2].title must be text.');
  });

  it('warns about unknown fields instead of failing', () => {
    const result = validated({ cards: [{ title: 'One', priority: 'high' }] });
    expect(result.warnings.some((w) => w.includes('cards[0].priority'))).toBe(true);
  });

  it('normalises dates and drops colours it does not know', () => {
    const result = validated({ cards: [{ title: 'One', due: '2026-04-30', color: 'neon' }] });
    expect(result.value.cards?.[0].due).toBe('2026-04-30T00:00:00.000Z');
    expect(result.value.cards?.[0].color).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('neon'))).toBe(true);
  });

  it('refuses input with nothing in it', () => {
    expect(validateImport({ kartaVersion: 1 }).ok).toBe(false);
    expect(validateImport('nope').ok).toBe(false);
  });
});

describe('applyImport', () => {
  const input = validated({
    statuses: [{ name: 'Blocked', color: 'copper' }],
    cards: [
      { key: 'a', title: 'Sign-in', status: 'Idé', labels: ['infra'], checklist: ['Register app'] },
      { key: 'b', title: 'Role check', status: 'Blocked' },
    ],
    notes: [{ text: 'Remember the redirect URI' }],
    edges: [
      { from: 'b', to: 'a', semantic: 'depends' },
      { from: 'b', to: 'Sign-in', semantic: 'relates' },
      { from: 'b', to: 'Nothing here' },
    ],
  }).value;

  it('creates nodes, labels and statuses, and resolves edges by key and by title', () => {
    const { doc, summary } = applyImport(board(), input, 'u1', 'merge');

    expect(summary.cards).toBe(2);
    expect(summary.notes).toBe(1);
    expect(summary.edges).toBe(2);
    expect(summary.labelsCreated).toEqual(['infra']);
    expect(summary.statusesCreated).toEqual(['Blocked']);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain('Nothing here');

    const cards = doc.nodes.filter(isCardNode);
    const signIn = cards.find((c) => c.title === 'Sign-in');
    const roleCheck = cards.find((c) => c.title === 'Role check');
    expect(signIn?.statusId).toBe(doc.statuses.find((s) => s.name === 'Idé')?.id);
    expect(signIn?.labelIds).toEqual([doc.labels[0].id]);
    expect(signIn?.checklist).toHaveLength(1);
    expect(doc.edges.every((e) => e.source === roleCheck?.id)).toBe(true);
    expect(doc.edges[0].target).toBe(signIn?.id);
  });

  it('lays out cards without positions in a grid, and leaves the input document alone', () => {
    const start = board();
    const { doc } = applyImport(start, input, 'u1', 'merge');
    expect(start.nodes).toHaveLength(0);
    const positions = doc.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('merges below what is already there, and replace clears first', () => {
    const first = applyImport(board(), input, 'u1', 'merge').doc;
    const merged = applyImport(first, input, 'u1', 'merge').doc;
    expect(merged.nodes).toHaveLength(6);
    expect(merged.labels).toHaveLength(1); // the label was reused, not duplicated
    const lowestFirst = Math.max(...first.nodes.map((n) => n.position.y + n.size.h));
    expect(Math.min(...merged.nodes.slice(3).map((n) => n.position.y))).toBeGreaterThan(lowestFirst);

    const replaced = applyImport(merged, input, 'u1', 'replace').doc;
    expect(replaced.nodes).toHaveLength(3);
    expect(replaced.statuses).toEqual(merged.statuses); // columns survive a replace
  });

  it('ranks cards within their own column, appending on a second import', () => {
    const column = validated({
      cards: [
        { title: 'One', status: 'Idé' },
        { title: 'Two', status: 'Idé' },
      ],
    }).value;

    const first = applyImport(board(), column, 'u1', 'merge').doc;
    const ranks = first.nodes.filter(isCardNode).map((c) => c.rank);
    expect(new Set(ranks).size).toBe(2);
    expect(ranks[0] < ranks[1]).toBe(true);

    const second = applyImport(first, column, 'u1', 'merge').doc;
    const all = second.nodes.filter(isCardNode).map((c) => c.rank);
    expect(new Set(all).size).toBe(4);
    expect([...all].sort()).toEqual(all); // the new pair lands after the old
  });
});

describe('export', () => {
  it('round-trips through the portable format', () => {
    const source = applyImport(
      board(),
      validated({
        cards: [
          { key: 'a', title: 'Sign-in', body: '# why', labels: ['infra'], due: '2026-04-30' },
          { key: 'b', title: 'Role check', checklist: [{ text: 'Wire it', done: true }] },
        ],
        edges: [{ from: 'b', to: 'a', semantic: 'depends', label: 'needs' }],
      }).value,
      'u1',
      'merge',
    ).doc;

    const portable = toPortable(source);
    expect(portable.cards?.map((c) => c.title)).toEqual(['Sign-in', 'Role check']);
    expect(portable.cards?.[0].position).toBeUndefined(); // grid positions are implied
    expect(portable.cards?.[0].due).toBe('2026-04-30');
    expect(portable.cards?.[1].checklist).toEqual([{ text: 'Wire it', done: true }]);
    expect(portable.edges).toEqual([
      { from: 'Role check', to: 'Sign-in', semantic: 'depends', label: 'needs' },
    ]);

    const again = applyImport(board(), validated(portable).value, 'u1', 'merge');
    expect(again.summary.cards).toBe(2);
    expect(again.summary.edges).toBe(1);
    expect(again.summary.warnings).toHaveLength(0);
    expect(JSON.parse(exportPortable(again.doc))).toEqual(JSON.parse(exportPortable(source)));
  });

  it('reads a full board document back in', () => {
    const source = applyImport(
      board(),
      validated({ cards: [{ title: 'One', status: 'Klar' }] }).value,
      'u1',
      'merge',
    ).doc;

    const result = validated(JSON.parse(JSON.stringify(source)));
    expect(result.value.cards?.[0].status).toBe('Klar');
    const { doc, summary } = applyImport(board(), result.value, 'u1', 'replace');
    expect(summary.cards).toBe(1);
    expect(doc.nodes.filter(isCardNode)[0].statusId).toBe(doc.statuses.find((s) => s.name === 'Klar')?.id);
  });
});
