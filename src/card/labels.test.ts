import { describe, expect, it } from 'vitest';
import { deleteLabels, labelUsage, unusedLabels } from '@/card/labels';
import { makeBoard, makeCard, makeLabel, makeNote } from '@/state/factories';

function fixture() {
  const doc = makeBoard({ title: 'Systems', ownerId: 'u1' });
  const combat = makeLabel({ name: 'combat', color: 'copper' });
  const feel = makeLabel({ name: 'feel', color: 'teal' });
  const typo = makeLabel({ name: 'gdfdfg' });
  doc.labels = [combat, feel, typo];
  const one = makeCard({ title: 'One', labelIds: [combat.id, feel.id], userId: 'u1' });
  const two = makeCard({ title: 'Two', labelIds: [combat.id], userId: 'u1' });
  const three = makeCard({ title: 'Three', userId: 'u1' });
  doc.nodes = [one, two, makeNote({ userId: 'u1' }), three];
  return { doc, combat, feel, typo, one, two, three };
}

describe('labelUsage', () => {
  it('counts the cards wearing each label, and only cards', () => {
    const { doc, combat, feel, typo } = fixture();
    const usage = labelUsage(doc.nodes);
    expect(usage.get(combat.id)).toBe(2);
    expect(usage.get(feel.id)).toBe(1);
    expect(usage.has(typo.id)).toBe(false);
  });
});

describe('unusedLabels', () => {
  it('names the labels no card wears, in board order', () => {
    const { doc, typo } = fixture();
    expect(unusedLabels(doc.labels, labelUsage(doc.nodes))).toEqual([typo]);
  });

  it('is every label on a board with no cards', () => {
    const { doc } = fixture();
    doc.nodes = [];
    expect(unusedLabels(doc.labels, labelUsage(doc.nodes))).toEqual(doc.labels);
  });
});

describe('deleteLabels', () => {
  it('takes a label off the board and off every card that carried it', () => {
    const { doc, combat, feel, typo, one, two, three } = fixture();
    const result = deleteLabels(doc, new Set([combat.id]));

    expect(result).toEqual({ labels: 1, cards: 2 });
    expect(doc.labels.map((l) => l.id)).toEqual([feel.id, typo.id]);
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    expect((byId.get(one.id) as typeof one).labelIds).toEqual([feel.id]);
    expect((byId.get(two.id) as typeof two).labelIds).toEqual([]);
    expect((byId.get(three.id) as typeof three).labelIds).toEqual([]);
  });

  it('deletes several at once, touching each card only once', () => {
    const { doc, combat, feel } = fixture();
    expect(deleteLabels(doc, new Set([combat.id, feel.id]))).toEqual({ labels: 2, cards: 2 });
    expect(doc.labels.map((l) => l.name)).toEqual(['gdfdfg']);
  });

  it('touches no card for a label nothing wears', () => {
    const { doc, typo } = fixture();
    expect(deleteLabels(doc, new Set([typo.id]))).toEqual({ labels: 1, cards: 0 });
    expect(doc.labels.map((l) => l.name)).toEqual(['combat', 'feel']);
  });

  it('ignores an id that is not a label', () => {
    const { doc } = fixture();
    const labels = [...doc.labels];
    expect(deleteLabels(doc, new Set(['nope']))).toEqual({ labels: 0, cards: 0 });
    expect(doc.labels).toEqual(labels);
  });
});
