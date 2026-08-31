import { useEffect, useMemo, useState } from 'react';
import { isCardNode, type BoardDoc, type CardNode, type Id, type LabelDef, type StatusDef } from '@/domain/board';
import { ApiError, api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';

/**
 * "Include nested boards" (spec 7.4): the children of the open board, one level
 * deep, projected into this board's columns. Child boards have their own status
 * and label ids, so they are matched by name; anything unmatched lands in "No
 * status". These cards are read-only here — editing them means opening the
 * board they live on.
 */

export interface NestedCard {
  card: CardNode;
  boardId: Id;
  boardTitle: string;
  statusName: string | null;
  labelNames: string[];
}

export interface NestedCardsResult {
  cards: NestedCard[];
  loading: boolean;
  error: string | null;
}

/** Fetched child documents, keyed by board id and version. */
const cache = new Map<string, BoardDoc>();
const CACHE_LIMIT = 24;

function cacheKey(boardId: Id, updatedAt: string): string {
  return `${boardId}@${updatedAt}`;
}

function remember(key: string, doc: BoardDoc): void {
  cache.set(key, doc);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

async function loadChild(boardId: Id, updatedAt: string): Promise<BoardDoc> {
  const key = cacheKey(boardId, updatedAt);
  const hit = cache.get(key);
  if (hit) return hit;

  const { doc } = await api.getBoard(boardId);
  remember(key, doc);
  if (doc.updatedAt !== updatedAt) remember(cacheKey(boardId, doc.updatedAt), doc);
  return doc;
}

function toNestedCards(doc: BoardDoc): NestedCard[] {
  const statusName = new Map<Id, string>(doc.statuses.map((s) => [s.id, s.name]));
  const labelName = new Map<Id, string>(doc.labels.map((l) => [l.id, l.name]));

  return doc.nodes.filter(isCardNode).map((card) => ({
    card,
    boardId: doc.id,
    boardTitle: doc.title,
    statusName: card.statusId !== null ? (statusName.get(card.statusId) ?? null) : null,
    labelNames: card.labelIds.map((id) => labelName.get(id)).filter((name): name is string => name !== undefined),
  }));
}

/**
 * The card, rewritten against the open board's statuses and labels so the
 * column layout and the filter treat it like any other card.
 */
export function projectNestedCard(nested: NestedCard, statuses: StatusDef[], labels: LabelDef[]): CardNode {
  const statusId = nested.statusName === null ? null : (findByName(statuses, nested.statusName)?.id ?? null);
  const labelIds = nested.labelNames
    .map((name) => findByName(labels, name)?.id)
    .filter((id): id is Id => id !== undefined);
  return { ...nested.card, statusId, labelIds };
}

function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const wanted = name.trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === wanted);
}

export function useNestedCards(enabled: boolean, boardId: Id | null): NestedCardsResult {
  const index = useBoardStore((s) => s.index);
  const [cards, setCards] = useState<NestedCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const children = useMemo(() => {
    if (!enabled || boardId === null || !index) return [];
    return index.boards
      .filter((b) => b.parentBoardId === boardId && b.deletedAt === null)
      .map((b) => ({ id: b.id, updatedAt: b.updatedAt }));
  }, [enabled, boardId, index]);

  // A stable dependency: the same children at the same versions never refetch.
  const signature = children.map((c) => cacheKey(c.id, c.updatedAt)).join(',');

  useEffect(() => {
    if (children.length === 0) {
      setCards([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void Promise.all(children.map((child) => loadChild(child.id, child.updatedAt)))
      .then((docs) => {
        if (cancelled) return;
        setCards(docs.flatMap(toNestedCards));
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setCards([]);
        setLoading(false);
        setError(cause instanceof ApiError ? cause.message : 'The nested boards could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
    // Keyed on `signature` alone: `children` is a new array every render, but
    // its content — board ids and versions — is exactly what the signature is.
  }, [signature]);

  return { cards, loading, error };
}
