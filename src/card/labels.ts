import { isCardNode, type BoardDoc, type BoardNode, type Id, type LabelDef } from '@/domain/board';

/**
 * What can be done to a board's labels, as pure functions over the document.
 * The dialog that offers them (`LabelEditor`) is thin on purpose: a label that
 * cannot be deleted is a board that slowly fills with typos, and the rule for
 * what a delete touches has to be checkable without a DOM.
 */

/** How many cards on the board wear each label. A label no card wears is absent. */
export function labelUsage(nodes: readonly BoardNode[]): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const node of nodes) {
    if (!isCardNode(node)) continue;
    for (const id of node.labelIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The labels no card wears, in the order the board lists them. */
export function unusedLabels(labels: readonly LabelDef[], usage: ReadonlyMap<Id, number>): LabelDef[] {
  return labels.filter((label) => (usage.get(label.id) ?? 0) === 0);
}

/**
 * Take labels off the board, and off every card that carries them, in one
 * write — so no card is left pointing at a label that is gone. Mutates the
 * document it is given, which is how the store's `mutate` hands out a draft.
 * Returns what it touched, for the sentence that reports it.
 */
export function deleteLabels(doc: BoardDoc, ids: ReadonlySet<Id>): { labels: number; cards: number } {
  const before = doc.labels.length;
  doc.labels = doc.labels.filter((label) => !ids.has(label.id));

  let cards = 0;
  for (const node of doc.nodes) {
    if (!isCardNode(node)) continue;
    if (!node.labelIds.some((id) => ids.has(id))) continue;
    // The card keeps everything else; only the references go.
    node.labelIds = node.labelIds.filter((id) => !ids.has(id));
    cards += 1;
  }

  return { labels: before - doc.labels.length, cards };
}
