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
  type ShapeNode,
  type TextNode,
} from '@/domain/board';
import { nowIso } from '@/lib/format';
import { rankAfterAll, rankBetween } from '@/lib/ranks';
import {
  makeCard,
  makeChecklistItem,
  makeEdge,
  makeLabel,
  makeNote,
  makeShape,
  makeStatus,
  makeText,
} from '@/state/factories';
import { gridColumns, gridSlot, layoutOrigin } from '@/io/layout';
import type { KartaImport, KartaImportCard } from '@/io/schema';

export interface ImportSummary {
  cards: number;
  notes: number;
  texts: number;
  shapes: number;
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
    texts: 0,
    shapes: 0,
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
    const textsIn = input.texts ?? [];
    const shapesIn = input.shapes ?? [];
    const origin = layoutOrigin(d.nodes);
    // Every node takes a slot, positioned or not, so the grid here is the one
    // the exporter reads backwards (`io/exporter.ts`). Numbering only the
    // positionless ones would slide everything after a placed card into its
    // neighbour's slot, stacking the two rectangles on a round trip. The order
    // the slots are handed out in — cards, notes, texts, shapes — is the order
    // the exporter walks the document.
    const columns = gridColumns(
      cardsIn.length + notesIn.length + textsIn.length + shapesIn.length,
    );
    let slot = 0;

    const place = (given: { x: number; y: number } | undefined): { x: number; y: number } => {
      const position = gridSlot(origin, columns, slot);
      slot += 1;
      return given ? { x: given.x, y: given.y } : position;
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

    /* ---------------- nodes ---------------- */

    const idByKey = new Map<string, Id>();
    // One namespace for every node list, first claimant wins, so an edge never
    // lands on whichever list happened to be read last.
    const claim = (key: string | undefined, id: Id): void => {
      if (key && !idByKey.has(key)) idByKey.set(key, id);
    };
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
        // Names that differ only in case are one label; the card must not
        // hold its id twice.
        labelIds: [...new Set((card.labels ?? []).map((name) => ensureLabel(name)))],
        dueDate: card.due ?? null,
        collapsed: card.collapsed ?? false,
        color: card.color ?? null,
        position: place(card.position),
        userId,
      });
      d.nodes.push(node);
      summary.cards += 1;
      claim(card.key, node.id);
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
      claim(note.key, node.id);
    }

    for (const text of textsIn) {
      const node: TextNode = makeText({
        text: text.text,
        fontSize: text.fontSize,
        align: text.align,
        weight: text.weight,
        color: text.color,
        position: place(text.position),
        userId,
      });
      d.nodes.push(node);
      summary.texts += 1;
      claim(text.key, node.id);
    }

    for (const shape of shapesIn) {
      const node: ShapeNode = makeShape({
        shape: shape.shape,
        label: shape.label,
        fill: shape.fill,
        stroke: shape.stroke,
        position: place(shape.position),
        userId,
      });
      d.nodes.push(node);
      summary.shapes += 1;
      claim(shape.key, node.id);
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
