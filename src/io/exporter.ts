/**
 * Export. Two flavours and one prompt.
 *
 * - **Full** is the board document verbatim: a backup that round-trips through
 *   `applyImport` without losing anything the format can carry.
 * - **Portable** is the {@link KartaImport} shape — names instead of ids, no
 *   positions where the grid would put a card anyway — which is what you hand
 *   back to a language model to extend.
 */

import {
  DEFAULT_TEXT_SIZE,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  isCardNode,
  isNoteNode,
  isShapeNode,
  isTextNode,
  type BoardDoc,
  type CardNode,
  type Id,
  type NoteNode,
  type ShapeNode,
  type TextNode,
} from '@/domain/board';
import { byRank } from '@/lib/ranks';
import { gridColumns, gridSlot } from '@/io/layout';
import type {
  KartaImport,
  KartaImportCard,
  KartaImportEdge,
  KartaImportNote,
  KartaImportShape,
  KartaImportText,
} from '@/io/schema';

const ORIGIN = { x: 0, y: 0 };
const SLOP = 1; // a position within a pixel of its grid slot is the grid slot
const MIDNIGHT = /T00:00:00\.000Z$/;

/** The whole document, pretty-printed. */
export function exportFull(doc: BoardDoc): string {
  return JSON.stringify(doc, null, 2);
}

function shortDate(iso: string): string {
  return MIDNIGHT.test(iso) ? iso.slice(0, 10) : iso;
}

function samePosition(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= SLOP && Math.abs(a.y - b.y) <= SLOP;
}

/** Every node the portable format can carry. */
type PortableNode = CardNode | NoteNode | TextNode | ShapeNode;

/**
 * The portable projection. Nodes keep their order; positions are dropped when
 * they match the slot the importer's grid would have chosen, so a board built
 * from an import exports as clean JSON again.
 */
export function toPortable(doc: BoardDoc): KartaImport {
  const cards = doc.nodes.filter(isCardNode);
  const notes = doc.nodes.filter(isNoteNode);
  const texts = doc.nodes.filter(isTextNode);
  const shapes = doc.nodes.filter(isShapeNode);
  // The order `applyImport` hands out its grid slots in.
  const placed: PortableNode[] = [...cards, ...notes, ...texts, ...shapes];

  const columns = gridColumns(placed.length);
  const slots = new Map<Id, { x: number; y: number }>();
  placed.forEach((node, i) => slots.set(node.id, gridSlot(ORIGIN, columns, i)));

  const statusName = new Map(doc.statuses.map((s) => [s.id, s.name]));
  const labelName = new Map(doc.labels.map((l) => [l.id, l.name]));

  const titleUses = new Map<string, number>();
  for (const card of cards) {
    const title = card.title.trim();
    if (title.length > 0) titleUses.set(title, (titleUses.get(title) ?? 0) + 1);
  }

  const referenced = new Set<Id>();
  for (const edge of doc.edges) {
    referenced.add(edge.source);
    referenced.add(edge.target);
  }

  // A key is only written where an edge needs one and the title cannot serve.
  const keys = new Map<Id, string>();
  cards.forEach((card, i) => {
    if (!referenced.has(card.id)) return;
    const title = card.title.trim();
    if (title.length > 0 && titleUses.get(title) === 1) return;
    keys.set(card.id, `c${i + 1}`);
  });
  notes.forEach((note, i) => {
    if (referenced.has(note.id)) keys.set(note.id, `n${i + 1}`);
  });
  texts.forEach((text, i) => {
    if (referenced.has(text.id)) keys.set(text.id, `t${i + 1}`);
  });
  shapes.forEach((shape, i) => {
    if (referenced.has(shape.id)) keys.set(shape.id, `s${i + 1}`);
  });

  const cardTitles = new Map<Id, string>(cards.map((card) => [card.id, card.title.trim()]));
  const reference = (id: Id): string | null => {
    const key = keys.get(id);
    if (key) return key;
    const title = cardTitles.get(id);
    return title !== undefined && title.length > 0 ? title : null;
  };

  const positionFor = (node: PortableNode): { x: number; y: number } | undefined => {
    const slot = slots.get(node.id);
    if (slot && samePosition(node.position, slot)) return undefined;
    return { x: Math.round(node.position.x), y: Math.round(node.position.y) };
  };

  const portableCards: KartaImportCard[] = cards.map((card) => {
    const out: KartaImportCard = { title: card.title };
    const key = keys.get(card.id);
    if (key) out.key = key;
    if (card.body.length > 0) out.body = card.body;

    const status = card.statusId ? statusName.get(card.statusId) : undefined;
    if (status) out.status = status;

    const labels = card.labelIds
      .map((id) => labelName.get(id))
      .filter((name): name is string => name !== undefined);
    if (labels.length > 0) out.labels = labels;

    if (card.checklist.length > 0) {
      out.checklist = [...card.checklist]
        .sort(byRank)
        .map((item) => (item.done ? { text: item.text, done: true } : item.text));
    }

    if (card.color) out.color = card.color;
    if (card.dueDate) out.due = shortDate(card.dueDate);

    const position = positionFor(card);
    if (position) out.position = position;
    if (card.collapsed) out.collapsed = true;

    return out;
  });

  const portableNotes: KartaImportNote[] = notes.map((note) => {
    const out: KartaImportNote = { text: note.text };
    const key = keys.get(note.id);
    if (key) out.key = key;
    if (note.color) out.color = note.color;
    const position = positionFor(note);
    if (position) out.position = position;
    return out;
  });

  const portableTexts: KartaImportText[] = texts.map((text) => {
    const out: KartaImportText = { text: text.text };
    const key = keys.get(text.id);
    if (key) out.key = key;
    if (text.fontSize !== DEFAULT_TEXT_SIZE) out.fontSize = text.fontSize;
    if (text.align !== 'left') out.align = text.align;
    if (text.weight !== 'regular') out.weight = text.weight;
    if (text.color) out.color = text.color;
    const position = positionFor(text);
    if (position) out.position = position;
    return out;
  });

  const portableShapes: KartaImportShape[] = shapes.map((shape) => {
    const out: KartaImportShape = { shape: shape.shape };
    const key = keys.get(shape.id);
    if (key) out.key = key;
    if (shape.label.length > 0) out.label = shape.label;
    if (shape.fill) out.fill = shape.fill;
    if (shape.stroke) out.stroke = shape.stroke;
    const position = positionFor(shape);
    if (position) out.position = position;
    return out;
  });

  const portableEdges: KartaImportEdge[] = [];
  for (const edge of doc.edges) {
    const from = reference(edge.source);
    const to = reference(edge.target);
    if (!from || !to) continue; // an endpoint the portable format cannot carry
    const out: KartaImportEdge = { from, to };
    if (edge.semantic !== 'relates') out.semantic = edge.semantic;
    if (edge.label) out.label = edge.label;
    portableEdges.push(out);
  }

  const value: KartaImport = { kartaVersion: 1, board: { title: doc.title } };
  if (doc.icon) value.board = { title: doc.title, icon: doc.icon };

  if (doc.statuses.length > 0) {
    value.statuses = [...doc.statuses]
      .sort((a, b) => a.order - b.order)
      .map((status) =>
        status.isDone
          ? { name: status.name, color: status.color, isDone: true }
          : { name: status.name, color: status.color },
      );
  }
  if (doc.labels.length > 0) {
    value.labels = doc.labels.map((label) => ({ name: label.name, color: label.color }));
  }
  if (portableCards.length > 0) value.cards = portableCards;
  if (portableNotes.length > 0) value.notes = portableNotes;
  if (portableTexts.length > 0) value.texts = portableTexts;
  if (portableShapes.length > 0) value.shapes = portableShapes;
  if (portableEdges.length > 0) value.edges = portableEdges;

  return value;
}

export function exportPortable(doc: BoardDoc): string {
  return JSON.stringify(toPortable(doc), null, 2);
}

/**
 * The prompt to hand a language model. It carries the whole contract: the
 * schema, one worked example, and the instruction to answer with JSON only.
 * Kept deliberately short — a long prompt is a prompt nobody pastes.
 *
 * Every key it advertises has to be one the importer reads *and* the app can
 * set and hand back on export. A key the app drops is JSON that silently
 * disappears: the model did as it was told, and half the answer never reaches
 * the board. `exporter.test.ts` parses this text and runs it through the real
 * validator for exactly that reason — a claim here is checked, not believed.
 */
export const AI_PROMPT_TEMPLATE = `You are helping me plan work on a visual board called Karta.

Reply with a single JSON object in the format below — no explanation, no markdown fence, JSON only.

Format:
{
  "kartaVersion": 1,
  "board":    { "title": "optional board title" },
  "statuses": [ { "name": "Building", "color": "bronze", "isDone": false } ],
  "labels":   [ { "name": "bug", "color": "copper" } ],
  "cards": [
    {
      "key": "a",                       // optional handle used by "edges" below
      "title": "Short imperative title",
      "body": "Markdown. Why this exists, what done looks like.",
      "status": "Building",               // a status NAME, matched case-insensitively
      "labels": ["bug"],                // label NAMES, created if new
      "checklist": ["First step", { "text": "Done already", "done": true }],
      "color": "blue",                  // straw bronze copper purple blue teal slate, #RRGGBB or #RGB
      "due": "2026-04-30",              // ISO date or YYYY-MM-DD
      "collapsed": false
    }
  ],
  "notes":  [ { "key": "n1", "text": "A sticky note on the canvas", "color": "straw" } ],
  "texts":  [ { "text": "Section heading", "fontSize": 32, "weight": "bold", "align": "left" } ],
  "shapes": [ { "key": "s1", "shape": "diamond", "label": "Ready?", "fill": "blue", "stroke": "slate" } ],
  "edges": [
    { "from": "a", "to": "Other card title", "semantic": "depends", "label": "needs" }
  ]
}

Rules:
- Only "title" is required on a card. Everything else is optional.
- "from" and "to" are a "key" from any card, note, text or shape, or a card title.
- A "key" must be unique across cards, notes, texts and shapes.
- "semantic" is one of: relates, depends, blocks, derives. Default is relates.
- "shape" is one of: rectangle, roundedRect, ellipse, diamond, triangle, hexagon,
  cylinder, parallelogram, cloud, document, process, callout.
- "fontSize" is ${MIN_TEXT_SIZE} to ${MAX_TEXT_SIZE}; "align" is left, center or right; "weight" is regular or bold.
- "texts" are headings laid on the canvas and "shapes" are flowchart boxes;
  leave both out unless I ask for a diagram.
- Leave positions out; Karta lays everything out in a grid.
- Use 5 to 15 cards unless I ask for more. Titles under 60 characters.

Example answer:
{
  "kartaVersion": 1,
  "cards": [
    { "key": "auth", "title": "Sign-in with Azure AD", "status": "Planned", "labels": ["infra"],
      "checklist": ["Register the app", "Wire the redirect"] },
    { "key": "roles", "title": "Role check on every route", "status": "Idea",
      "body": "Blocked until sign-in exists." }
  ],
  "edges": [ { "from": "roles", "to": "auth", "semantic": "depends" } ]
}

Here is what I want on the board:
`;
