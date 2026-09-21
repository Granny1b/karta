import { isCardNode, type BoardDoc, type BoardIndex, type BoardSummary, type CardNode, type Id } from '@/domain/board';
import type { Filter } from '@/state/uiStore';

export interface TreeNode {
  summary: BoardSummary;
  children: TreeNode[];
  /**
   * The board it was nested in is gone, so the tree shows it at the top rather
   * than losing it. The panel says so on the row: a board that appears at the
   * top level for no visible reason reads as the tree being broken.
   */
  detached: boolean;
}

/** Cards only — notes, images, groups and board links are canvas-only (spec 7.4). */
export function cardNodes(doc: BoardDoc | null): CardNode[] {
  if (!doc) return [];
  return doc.nodes.filter(isCardNode);
}

/** Checklist completion, used by the progress ring and the card editor. */
export function progressOf(card: CardNode): { done: number; total: number } {
  let done = 0;
  for (const item of card.checklist) if (item.done) done += 1;
  return { done, total: card.checklist.length };
}

/**
 * Filter facets are ANDed; values inside a facet are ORed. On the canvas a
 * non-match is dimmed rather than hidden, so the layout never jumps (spec 7.4).
 */
export function matchesFilter(card: CardNode, filter: Filter): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text.length > 0) {
    const haystack = [card.title, card.body, ...card.checklist.map((i) => i.text)].join('\n').toLowerCase();
    if (!haystack.includes(text)) return false;
  }

  if (filter.labelIds.length > 0 && !filter.labelIds.some((id) => card.labelIds.includes(id))) return false;

  if (filter.statusIds.length > 0) {
    if (card.statusId === null || !filter.statusIds.includes(card.statusId)) return false;
  }

  if (filter.hasDue && card.dueDate === null) return false;

  if (filter.hasOpenChecklist && !card.checklist.some((item) => !item.done)) return false;

  return true;
}

/**
 * The sidebar tree.
 *
 * Two rules, and one invariant that matters more than either: **every live
 * board appears exactly once**. A board missing from this tree is a board with
 * no way back to it.
 *
 * - Soft-deleted boards are left out. The document still exists — blob soft
 *   delete is the 14-day undo behind it — so only `deletedAt` separates a board
 *   that is gone from one that is not.
 * - A board whose parent is gone, or whose parent chain runs in a circle, is
 *   surfaced at the root and flagged `detached`, so the walk cannot hang and
 *   nothing falls out of the tree on the way.
 */
export function boardTree(index: BoardIndex | null): TreeNode[] {
  if (!index) return [];

  const live = index.boards.filter((b) => b.deletedAt === null);
  const byId = new Map<Id, BoardSummary>(live.map((b) => [b.id, b]));
  const childrenOf = new Map<Id, BoardSummary[]>();
  const roots: BoardSummary[] = [];
  /** Roots that were nested under something until that something went away. */
  const orphans = new Set<Id>();

  for (const summary of live) {
    const parentId = summary.parentBoardId;
    if (parentId !== null && byId.has(parentId) && parentId !== summary.id) {
      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(summary);
      else childrenOf.set(parentId, [summary]);
    } else {
      roots.push(summary);
      if (parentId !== null) orphans.add(summary.id);
    }
  }

  const byTitle = (a: BoardSummary, b: BoardSummary): number =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

  const visited = new Set<Id>();
  const build = (summary: BoardSummary, detached: boolean): TreeNode => {
    visited.add(summary.id);
    const children = (childrenOf.get(summary.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort(byTitle)
      .map((child) => build(child, false));
    return { summary, children, detached };
  };

  const top = roots.sort(byTitle).map((summary) => build(summary, orphans.has(summary.id)));

  // Whatever the walk could not reach from a root is in a cycle: A's parent is
  // B and B's parent is A. Both used to vanish from the tree entirely. Lifting
  // the first one seen makes the pair reachable again, and the second nests
  // under it on the way down.
  for (const summary of live.slice().sort(byTitle)) {
    if (visited.has(summary.id)) continue;
    top.push(build(summary, true));
  }

  return top.sort((a, b) => byTitle(a.summary, b.summary));
}
