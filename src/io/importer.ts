/**
 * Applying a validated {@link KartaImport} to a board document.
 *
 * Merge is additive and never destructive: nothing already on the board is
 * removed, renamed or recoloured. Replace clears the nodes and edges first,
 * keeping the board's identity, access list, statuses, labels and media.
 */

import { produce } from 'immer';
import {
  isCardNode,
  type BoardDoc,
  type CardNode,
  type ColorToken,
  type Id,
  type NoteNode,
} from '@/domain/board';
import { nowIso } from '@/lib/format';
import { rankAfterAll, rankBetween } from '@/lib/ranks';
import {
  makeCard,
  makeChecklistItem,
  makeEdge,
  makeLabel,
  makeNote,
  makeStatus,
} from '@/state/factories';
import { gridColumns, gridSlot, layoutOrigin } from '@/io/layout';
import type { KartaImport, KartaImportCard } from '@/io/schema';

export interface ImportSummary {
  cards: number;
  notes: number;
  edges: number;
  labelsCreated: string[];
  statusesCreated: string[];
  warnings: string[];
}

export type ImportMode = 'merge' | 'replace';

const norm = (name: string): string => name.trim().toLowerCase();

function checklistOf(card: KartaImportCard): ReturnType<typeof makeChecklistItem>[] {
  const items = card.checklist ?? [];
  let rank: string | null = null;
  return items.map((entry) => {
    const item = typeof entry === 'string' ? { text: entry, done: false } : entry;
    rank = rankBetween(rank, null);
    return makeChecklistItem({ text: item.text, done: item.done ?? false, rank });
  });
}

/**
 * @param doc    the board to import into — never mutated
 * @param input  a value from `validateImport`
 * @param userId the SWA user id stamped on everything created
 */
export function applyImport(
  doc: BoardDoc,
  input: KartaImport,
  userId: string,
  mode: ImportMode,
): { doc: BoardDoc; summary: ImportSummary } {
  const summary: ImportSummary = {
    cards: 0,
    notes: 0,
    edges: 0,
    labelsCreated: [],
    statusesCreated: [],
    warnings: [],
  };

  const next = produce(doc, (d) => {
    if (mode === 'replace') {
      d.nodes = [];
      d.edges = [];
    }

    if (input.board?.title) d.title = input.board.title;
    if (input.board && 'icon' in input.board) d.icon = input.board.icon ?? null;

    /* ---------------- statuses ---------------- */

    const statusIdByName = new Map<string, Id>();
    for (const status of d.statuses) statusIdByName.set(norm(status.name), status.id);
    let nextOrder = d.statuses.reduce((max, s) => Math.max(max, s.order + 1), 0);

    const ensureStatus = (name: string, color?: ColorToken, isDone?: boolean): Id => {
      const key = norm(name);
      const existing = statusIdByName.get(key);
      if (existing) return existing;
      const created = makeStatus({
        name: name.trim(),
        color: color ?? 'slate',
        order: nextOrder,
        isDone: isDone ?? false,
      });
      nextOrder += 1;
      d.statuses.push(created);
      statusIdByName.set(key, created.id);
      summary.statusesCreated.push(created.name);
      return created.id;
    };

    for (const status of input.statuses ?? []) ensureStatus(status.name, status.color, status.isDone);

    /* ---------------- labels ---------------- */

    const labelIdByName = new Map<string, Id>();
    for (const label of d.labels) labelIdByName.set(norm(label.name), label.id);

    const ensureLabel = (name: string, color?: ColorToken): Id => {
      const key = norm(name);
      const existing = labelIdByName.get(key);
      if (existing) return existing;
      const created = makeLabel({ name: name.trim(), color: color ?? 'slate' });
      d.labels.push(created);
      labelIdByName.set(key, created.id);
      summary.labelsCreated.push(created.name);
      return created.id;
    };

    for (const label of input.labels ?? []) ensureLabel(label.name, label.color);

    /* ---------------- layout ---------------- */

    const cardsIn = input.cards ?? [];
    const notesIn = input.notes ?? [];
    const autoCount =
      cardsIn.filter((c) => !c.position).length + notesIn.filter((n) => !n.position).length;
    const origin = layoutOrigin(d.nodes);
    const columns = gridColumns(autoCount);
    let slot = 0;

    const place = (given: { x: number; y: number } | undefined): { x: number; y: number } => {
      if (given) return { x: given.x, y: given.y };
      const position = gridSlot(origin, columns, slot);
      slot += 1;
      return position;
    };

    /* ---------------- ranks ---------------- */

    const existingCards = d.nodes.filter(isCardNode);
    const issued = new Map<string, string>();
    const nextRank = (statusId: Id | null): string => {
      const key = statusId ?? '';
      const previous = issued.get(key);
      const rank =
        previous === undefined
          ? rankAfterAll(existingCards.filter((c) => c.statusId === statusId).map((c) => c.rank))
          : rankBetween(previous, null);
      issued.set(key, rank);
      return rank;
    };

    /* ---------------- cards and notes ---------------- */

    const idByKey = new Map<string, Id>();
    const idsByTitle = new Map<string, Id[]>();
    const remember = (title: string, id: Id): void => {
      const key = title.trim();
      if (key.length === 0) return;
      const bucket = idsByTitle.get(key);
      if (bucket) bucket.push(id);
      else idsByTitle.set(key, [id]);
    };
    for (const node of existingCards) remember(node.title, node.id);

    for (const card of cardsIn) {
      const statusId = card.status ? ensureStatus(card.status) : null;
      const node: CardNode = makeCard({
        title: card.title,
        body: card.body ?? '',
        checklist: checklistOf(card),
        statusId,
        rank: nextRank(statusId),
        labelIds: (card.labels ?? []).map((name) => ensureLabel(name)),
        dueDate: card.due ?? null,
        collapsed: card.collapsed ?? false,
        color: card.color ?? null,
        position: place(card.position),
        userId,
      });
      d.nodes.push(node);
      summary.cards += 1;
      if (card.key) idByKey.set(card.key, node.id);
      remember(node.title, node.id);
    }

    for (const note of notesIn) {
      const node: NoteNode = makeNote({
        text: note.text,
        color: note.color,
        position: place(note.position),
        userId,
      });
      d.nodes.push(node);
      summary.notes += 1;
      if (note.key) idByKey.set(note.key, node.id);
    }

    /* ---------------- edges ---------------- */

    const nodeIds = new Set<Id>(d.nodes.map((n) => n.id));
    const lowerTitles = new Map<string, Id[]>();
    for (const [title, ids] of idsByTitle) {
      const key = title.toLowerCase();
      const bucket = lowerTitles.get(key);
      if (bucket) bucket.push(...ids);
      else lowerTitles.set(key, [...ids]);
    }

    const resolve = (ref: string): Id | null => {
      const trimmed = ref.trim();
      const byKey = idByKey.get(trimmed);
      if (byKey) return byKey;
      if (nodeIds.has(trimmed)) return trimmed;

      const exact = idsByTitle.get(trimmed);
      const matches = exact ?? lowerTitles.get(trimmed.toLowerCase());
      if (!matches || matches.length === 0) return null;
      if (matches.length > 1) {
        summary.warnings.push(`More than one card is called "${trimmed}"; the arrow used the first one.`);
      }
      return matches[0];
    };

    const existingPairs = new Set(d.edges.map((e) => `${e.source}>${e.target}:${e.semantic}`));

    for (const edge of input.edges ?? []) {
      const source = resolve(edge.from);
      const target = resolve(edge.to);
      if (!source || !target) {
        const missing = !source ? edge.from : edge.to;
        summary.warnings.push(`Arrow "${edge.from}" → "${edge.to}" was skipped: nothing called "${missing}".`);
        continue;
      }
      if (source === target) {
        summary.warnings.push(`Arrow "${edge.from}" → "${edge.to}" was skipped: it points at itself.`);
        continue;
      }

      const semantic = edge.semantic ?? 'relates';
      const pair = `${source}>${target}:${semantic}`;
      if (existingPairs.has(pair)) continue;
      existingPairs.add(pair);

      d.edges.push(makeEdge({ source, target, semantic, label: edge.label ?? null }));
      summary.edges += 1;
    }

    d.updatedAt = nowIso();
  });

  return { doc: next, summary };
}
