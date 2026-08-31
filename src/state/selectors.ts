import { isCardNode, type BoardDoc, type BoardIndex, type BoardSummary, type CardNode, type Id } from '@/domain/board';
import type { Filter } from '@/state/uiStore';

export interface TreeNode {
  summary: BoardSummary;
  children: TreeNode[];
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
 * The sidebar tree. Soft-deleted boards are left out, orphans (a parent that is
 * gone or deleted) surface at the root, and a cyclic `parentBoardId` chain
 * cannot hang the walk.
 */
export function boardTree(index: BoardIndex | null): TreeNode[] {
  if (!index) return [];

  const live = index.boards.filter((b) => b.deletedAt === null);
  const byId = new Map<Id, BoardSummary>(live.map((b) => [b.id, b]));
  const childrenOf = new Map<Id, BoardSummary[]>();
  const roots: BoardSummary[] = [];

  for (const summary of live) {
    const parentId = summary.parentBoardId;
    if (parentId !== null && byId.has(parentId) && parentId !== summary.id) {
      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(summary);
      else childrenOf.set(parentId, [summary]);
    } else {
      roots.push(summary);
    }
  }

  const byTitle = (a: BoardSummary, b: BoardSummary): number =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

  const visited = new Set<Id>();
  const build = (summary: BoardSummary): TreeNode => {
    visited.add(summary.id);
    const children = (childrenOf.get(summary.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort(byTitle)
      .map(build);
    return { summary, children };
  };

  return roots.sort(byTitle).map(build);
}
