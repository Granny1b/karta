/**
 * The portable Karta format.
 *
 * It exists so a person can hand a language model a prompt, get JSON back and
 * paste it in. Everything about it is chosen to be easy to emit by hand or by
 * machine: names instead of ids, positions optional, unknown fields ignored.
 * `docs/AI_IMPORT.md` is the human-facing description of the same thing.
 */

import type { ColorToken, EdgeSemantic, HexColor } from '@/domain/board';
import { TEMPER_TOKENS, isColorToken, isHexColor } from '@/lib/colors';

export interface KartaImportBoard {
  title?: string;
  icon?: string | null;
}

export interface KartaImportStatus {
  name: string;
  color?: ColorToken;
  isDone?: boolean;
}

export interface KartaImportLabel {
  name: string;
  color?: ColorToken;
}

export interface KartaImportChecklistItem {
  text: string;
  done?: boolean;
}

export interface KartaImportCard {
  /** A local handle for edges to point at. Never persisted. */
  key?: string;
  title: string;
  /** Markdown. */
  body?: string;
  /** Status *name*, matched case-insensitively; created when unknown. */
  status?: string;
  /** Label *names*, created on demand. */
  labels?: string[];
  checklist?: (string | KartaImportChecklistItem)[];
  color?: ColorToken | HexColor;
  /** ISO date or `YYYY-MM-DD`. Normalised to ISO by {@link validateImport}. */
  due?: string;
  /** Optional — cards without one are laid out in a grid. */
  position?: { x: number; y: number };
  collapsed?: boolean;
}

export interface KartaImportNote {
  key?: string;
  text: string;
  color?: ColorToken | HexColor;
  position?: { x: number; y: number };
}

export interface KartaImportEdge {
  /** A card key, or a card title. */
  from: string;
  to: string;
  semantic?: EdgeSemantic;
  label?: string;
}

export interface KartaImport {
  kartaVersion: 1;
  board?: KartaImportBoard;
  statuses?: KartaImportStatus[];
  labels?: KartaImportLabel[];
  cards?: KartaImportCard[];
  notes?: KartaImportNote[];
  edges?: KartaImportEdge[];
}

export type ValidationResult =
  | { ok: true; value: KartaImport; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export const EDGE_SEMANTICS: readonly EdgeSemantic[] = ['relates', 'depends', 'blocks', 'derives'];

const COLOR_LIST = TEMPER_TOKENS.join(', ');
const SEMANTIC_LIST = EDGE_SEMANTICS.join(', ');
const MAX_ERRORS = 40;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const BOARD_KEYS = new Set(['title', 'icon']);
const STATUS_KEYS = new Set(['name', 'color', 'isDone']);
const LABEL_KEYS = new Set(['name', 'color']);
const CARD_KEYS = new Set([
  'key',
  'title',
  'body',
  'status',
  'labels',
  'checklist',
  'color',
  'due',
  'position',
  'collapsed',
]);
const NOTE_KEYS = new Set(['key', 'text', 'color', 'position']);
const EDGE_KEYS = new Set(['from', 'to', 'semantic', 'label']);
const ROOT_KEYS = new Set([
  'kartaVersion',
  'board',
  'statuses',
  'labels',
  'cards',
  'notes',
  'edges',
]);

/* ------------------------------------------------------------------ *
 * Problem collection
 * ------------------------------------------------------------------ */

class Problems {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];

  error(message: string): void {
    this.errors.push(message);
  }

  warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(p: Problems, obj: Record<string, unknown>, path: string, known: Set<string>): void {
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) p.warn(`${path}${path ? '.' : ''}${key} is not a Karta field and was ignored.`);
  }
}

function readString(
  p: Problems,
  value: unknown,
  path: string,
  options: { required?: boolean } = {},
): string | undefined {
  if (value === undefined || value === null) {
    if (options.required) p.error(`${path} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    p.error(`${path} must be text.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (options.required) p.error(`${path} cannot be empty.`);
    return undefined;
  }
  return trimmed;
}

function readBoolean(p: Problems, value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    p.error(`${path} must be true or false.`);
    return undefined;
  }
  return value;
}

function readArray(p: Problems, value: unknown, path: string): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    p.error(`${path} must be a list.`);
    return undefined;
  }
  return value;
}

function readPosition(
  p: Problems,
  value: unknown,
  path: string,
): { x: number; y: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    p.error(`${path} must be an object like { "x": 0, "y": 0 }.`);
    return undefined;
  }
  const read = (key: 'x' | 'y'): number | undefined => {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      p.error(`${path}.${key} must be a number.`);
      return undefined;
    }
    return raw;
  };
  const x = read('x');
  const y = read('y');
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

/** Tokens and `#RRGGBB` both allowed; anything else is dropped with a warning. */
function readColor(p: Problems, value: unknown, path: string): ColorToken | HexColor | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    p.warn(`${path} must be a colour name and was ignored.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (isColorToken(trimmed)) return trimmed;
  if (isHexColor(trimmed)) return trimmed.toLowerCase();
  p.warn(`${path} "${trimmed}" is not a Karta colour (${COLOR_LIST}, or #RRGGBB) and was ignored.`);
  return undefined;
}

/** Statuses and labels carry tokens only — a hex value has nowhere to live. */
function readToken(p: Problems, value: unknown, path: string): ColorToken | undefined {
  const color = readColor(p, value, path);
  if (color === undefined) return undefined;
  if (isColorToken(color)) return color;
  p.warn(`${path} must be one of ${COLOR_LIST}; the custom colour was ignored.`);
  return undefined;
}

/** `YYYY-MM-DD` or anything `Date` understands, normalised to ISO 8601 UTC. */
function readDue(p: Problems, value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    p.warn(`${path} must be a date and was ignored.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const stamp = Date.parse(DATE_ONLY.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (!Number.isFinite(stamp)) {
    p.warn(`${path} "${trimmed}" is not a date Karta understands and was ignored.`);
    return undefined;
  }
  return new Date(stamp).toISOString();
}

/* ------------------------------------------------------------------ *
 * Shape detection — a bare array of cards and a full board export are
 * both accepted, and normalised into the portable shape first.
 * ------------------------------------------------------------------ */

function looksLikeBoardDoc(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    (typeof value.schemaVersion === 'number' || Array.isArray(value.statuses))
  );
}

function nameById(list: unknown, id: unknown): string | undefined {
  if (!Array.isArray(list) || typeof id !== 'string') return undefined;
  for (const entry of list) {
    if (isRecord(entry) && entry.id === id && typeof entry.name === 'string') return entry.name;
  }
  return undefined;
}

/** A full `BoardDoc` export, flattened into the portable shape. */
function fromBoardDoc(doc: Record<string, unknown>, p: Problems): Record<string, unknown> {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const statusList = Array.isArray(doc.statuses) ? doc.statuses : [];
  const labelList = Array.isArray(doc.labels) ? doc.labels : [];

  const cards: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (node.kind === 'card') {
      const checklist = Array.isArray(node.checklist)
        ? node.checklist
            .filter(isRecord)
            .map((item) => ({ text: item.text, done: item.done === true }))
        : undefined;
      const labels = Array.isArray(node.labelIds)
        ? node.labelIds.map((id) => nameById(labelList, id)).filter((name) => name !== undefined)
        : undefined;
      cards.push({
        key: typeof node.id === 'string' ? node.id : undefined,
        title: node.title,
        body: node.body,
        status: nameById(statusList, node.statusId),
        labels,
        checklist,
        color: node.color ?? undefined,
        due: node.dueDate ?? undefined,
        position: node.position,
        collapsed: node.collapsed === true ? true : undefined,
      });
    } else if (node.kind === 'note') {
      notes.push({
        key: typeof node.id === 'string' ? node.id : undefined,
        text: node.text,
        color: node.color ?? undefined,
        position: node.position,
      });
    } else {
      skipped += 1;
    }
  }

  if (skipped > 0) {
    p.warn(
      `${skipped} node${skipped === 1 ? '' : 's'} (images, groups or board links) cannot travel in the portable format and ${skipped === 1 ? 'was' : 'were'} skipped.`,
    );
  }

  const edges = Array.isArray(doc.edges)
    ? doc.edges.filter(isRecord).map((edge) => ({
        from: edge.source,
        to: edge.target,
        semantic: edge.semantic,
        label: edge.label ?? undefined,
      }))
    : undefined;

  const statuses = [...statusList]
    .filter(isRecord)
    .sort((a, b) => (typeof a.order === 'number' ? a.order : 0) - (typeof b.order === 'number' ? b.order : 0))
    .map((s) => ({ name: s.name, color: s.color, isDone: s.isDone === true }));

  const labels = labelList.filter(isRecord).map((l) => ({ name: l.name, color: l.color }));

  return {
    kartaVersion: 1,
    board: { title: doc.title, icon: doc.icon ?? null },
    statuses,
    labels,
    cards,
    notes,
    edges,
  };
}

/** A bare array is a list of cards, with any `{ text }` entries taken as notes. */
function fromArray(entries: unknown[]): Record<string, unknown> {
  const cards: unknown[] = [];
  const notes: unknown[] = [];
  for (const entry of entries) {
    if (isRecord(entry) && entry.title === undefined && typeof entry.text === 'string') notes.push(entry);
    else cards.push(entry);
  }
  return { kartaVersion: 1, cards, notes };
}

function detectShape(raw: unknown, p: Problems): Record<string, unknown> | null {
  if (Array.isArray(raw)) return fromArray(raw);
  if (looksLikeBoardDoc(raw)) return fromBoardDoc(raw, p);
  if (isRecord(raw)) return raw;
  p.error('The JSON must be an object, or an array of cards.');
  return null;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function validateStatuses(p: Problems, raw: unknown): KartaImportStatus[] | undefined {
  const list = readArray(p, raw, 'statuses');
  if (!list) return undefined;

  const out: KartaImportStatus[] = [];
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const path = `statuses[${i}]`;
    if (!isRecord(entry)) {
      const name = readString(p, entry, path, { required: true });
      if (name) out.push({ name });
      return;
    }
    unknownKeys(p, entry, path, STATUS_KEYS);
    const name = readString(p, entry.name, `${path}.name`, { required: true });
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      p.warn(`${path}.name "${name}" appears twice; the duplicate was ignored.`);
      return;
    }
    seen.add(key);
    out.push({
      name,
      color: readToken(p, entry.color, `${path}.color`),
      isDone: readBoolean(p, entry.isDone, `${path}.isDone`),
    });
  });
  return out;
}

function validateLabels(p: Problems, raw: unknown): KartaImportLabel[] | undefined {
  const list = readArray(p, raw, 'labels');
  if (!list) return undefined;

  const out: KartaImportLabel[] = [];
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const path = `labels[${i}]`;
    const record = isRecord(entry) ? entry : null;
    if (record) unknownKeys(p, record, path, LABEL_KEYS);
    const name = readString(p, record ? record.name : entry, record ? `${path}.name` : path, {
      required: true,
    });
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      p.warn(`${path}.name "${name}" appears twice; the duplicate was ignored.`);
      return;
    }
    seen.add(key);
    out.push({ name, color: record ? readToken(p, record.color, `${path}.color`) : undefined });
  });
  return out;
}

function validateChecklist(
  p: Problems,
  raw: unknown,
  path: string,
): KartaImportChecklistItem[] | undefined {
  const list = readArray(p, raw, path);
  if (!list) return undefined;

  const out: KartaImportChecklistItem[] = [];
  list.forEach((entry, i) => {
    const itemPath = `${path}[${i}]`;
    if (typeof entry === 'string') {
      const text = readString(p, entry, itemPath);
      if (text) out.push({ text, done: false });
      return;
    }
    if (!isRecord(entry)) {
      p.error(`${itemPath} must be text, or an object like { "text": "…", "done": false }.`);
      return;
    }
    unknownKeys(p, entry, itemPath, new Set(['text', 'done']));
    const text = readString(p, entry.text, `${itemPath}.text`, { required: true });
    if (!text) return;
    out.push({ text, done: readBoolean(p, entry.done, `${itemPath}.done`) ?? false });
  });
  return out;
}

function validateCards(p: Problems, raw: unknown): KartaImportCard[] | undefined {
  const list = readArray(p, raw, 'cards');
  if (!list) return undefined;

  const out: KartaImportCard[] = [];
  const keys = new Set<string>();
  list.forEach((entry, i) => {
    const path = `cards[${i}]`;
    if (typeof entry === 'string') {
      const title = readString(p, entry, path, { required: true });
      if (title) out.push({ title });
      return;
    }
    if (!isRecord(entry)) {
      p.error(`${path} must be an object with a title.`);
      return;
    }
    unknownKeys(p, entry, path, CARD_KEYS);

    const title = readString(p, entry.title, `${path}.title`, { required: true });
    if (!title) return;

    const key = readString(p, entry.key, `${path}.key`);
    if (key !== undefined) {
      if (keys.has(key)) p.warn(`${path}.key "${key}" is used more than once; edges may attach to the wrong card.`);
      keys.add(key);
    }

    // Markdown keeps its whitespace — trimming a body would eat its layout.
    let body: string | undefined;
    if (entry.body !== undefined && entry.body !== null) {
      if (typeof entry.body !== 'string') p.error(`${path}.body must be text.`);
      else if (entry.body.length > 0) body = entry.body;
    }

    const labelsRaw = readArray(p, entry.labels, `${path}.labels`);
    const labels = labelsRaw
      ?.map((name, j) => readString(p, name, `${path}.labels[${j}]`, { required: true }))
      .filter((name): name is string => name !== undefined);

    out.push({
      key,
      title,
      body,
      status: readString(p, entry.status, `${path}.status`),
      labels: labels && labels.length > 0 ? labels : undefined,
      checklist: validateChecklist(p, entry.checklist, `${path}.checklist`),
      color: readColor(p, entry.color, `${path}.color`),
      due: readDue(p, entry.due, `${path}.due`),
      position: readPosition(p, entry.position, `${path}.position`),
      collapsed: readBoolean(p, entry.collapsed, `${path}.collapsed`),
    });
  });
  return out;
}

function validateNotes(p: Problems, raw: unknown): KartaImportNote[] | undefined {
  const list = readArray(p, raw, 'notes');
  if (!list) return undefined;

  const out: KartaImportNote[] = [];
  list.forEach((entry, i) => {
    const path = `notes[${i}]`;
    if (typeof entry === 'string') {
      const text = readString(p, entry, path, { required: true });
      if (text) out.push({ text });
      return;
    }
    if (!isRecord(entry)) {
      p.error(`${path} must be an object with text.`);
      return;
    }
    unknownKeys(p, entry, path, NOTE_KEYS);
    const text = readString(p, entry.text, `${path}.text`, { required: true });
    if (!text) return;
    out.push({
      key: readString(p, entry.key, `${path}.key`),
      text,
      color: readColor(p, entry.color, `${path}.color`),
      position: readPosition(p, entry.position, `${path}.position`),
    });
  });
  return out;
}

function validateEdges(p: Problems, raw: unknown): KartaImportEdge[] | undefined {
  const list = readArray(p, raw, 'edges');
  if (!list) return undefined;

  const out: KartaImportEdge[] = [];
  list.forEach((entry, i) => {
    const path = `edges[${i}]`;
    if (!isRecord(entry)) {
      p.error(`${path} must be an object like { "from": "…", "to": "…" }.`);
      return;
    }
    unknownKeys(p, entry, path, EDGE_KEYS);
    const from = readString(p, entry.from, `${path}.from`, { required: true });
    const to = readString(p, entry.to, `${path}.to`, { required: true });
    if (!from || !to) return;

    let semantic: EdgeSemantic | undefined;
    const rawSemantic = readString(p, entry.semantic, `${path}.semantic`);
    if (rawSemantic !== undefined) {
      const lower = rawSemantic.toLowerCase();
      if ((EDGE_SEMANTICS as readonly string[]).includes(lower)) semantic = lower as EdgeSemantic;
      else p.warn(`${path}.semantic "${rawSemantic}" is not one of ${SEMANTIC_LIST}; "relates" was used.`);
    }

    out.push({ from, to, semantic, label: readString(p, entry.label, `${path}.label`) });
  });
  return out;
}

function validateBoard(p: Problems, raw: unknown): KartaImportBoard | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    p.error('board must be an object like { "title": "…" }.');
    return undefined;
  }
  unknownKeys(p, raw, 'board', BOARD_KEYS);
  const board: KartaImportBoard = {};
  const title = readString(p, raw.title, 'board.title');
  if (title !== undefined) board.title = title;
  if ('icon' in raw) board.icon = typeof raw.icon === 'string' ? raw.icon : null;
  return board;
}

function cap(errors: string[]): string[] {
  if (errors.length <= MAX_ERRORS) return errors;
  const extra = errors.length - MAX_ERRORS;
  return [...errors.slice(0, MAX_ERRORS), `…and ${extra} more problem${extra === 1 ? '' : 's'}.`];
}

/**
 * Validate and normalise anything pasted into the import dialog. The returned
 * value is safe for {@link applyImport}: names are trimmed, dates are ISO,
 * colours are known, and every optional field that could not be understood has
 * been dropped with a warning rather than failing the whole import.
 */
export function validateImport(raw: unknown): ValidationResult {
  const p = new Problems();
  const shape = detectShape(raw, p);
  if (!shape) return { ok: false, errors: cap(p.errors), warnings: p.warnings };

  unknownKeys(p, shape, '', ROOT_KEYS);

  const version = shape.kartaVersion;
  if (version !== undefined && version !== null && version !== 1) {
    p.error(`kartaVersion must be 1 (this file says ${JSON.stringify(version)}).`);
  }

  const value: KartaImport = { kartaVersion: 1 };
  const board = validateBoard(p, shape.board);
  if (board && (board.title !== undefined || 'icon' in board)) value.board = board;

  const statuses = validateStatuses(p, shape.statuses);
  if (statuses && statuses.length > 0) value.statuses = statuses;

  const labels = validateLabels(p, shape.labels);
  if (labels && labels.length > 0) value.labels = labels;

  const cards = validateCards(p, shape.cards);
  if (cards && cards.length > 0) value.cards = cards;

  const notes = validateNotes(p, shape.notes);
  if (notes && notes.length > 0) value.notes = notes;

  const edges = validateEdges(p, shape.edges);
  if (edges && edges.length > 0) value.edges = edges;

  if (p.errors.length === 0 && !value.cards && !value.notes && !value.statuses && !value.labels) {
    p.error('There is nothing to import — no cards and no notes were found.');
  }

  if (p.errors.length > 0) return { ok: false, errors: cap(p.errors), warnings: p.warnings };
  return { ok: true, value, warnings: p.warnings };
}
