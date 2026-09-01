/**
 * The portable Karta format.
 *
 * It exists so a person can hand a language model a prompt, get JSON back and
 * paste it in. Everything about it is chosen to be easy to emit by hand or by
 * machine: names instead of ids, positions optional, unknown fields ignored.
 * `docs/AI_IMPORT.md` is the human-facing description of the same thing.
 */

import {
  MAX_CARD_BODY,
  MAX_CHECKLIST_TEXT,
  MAX_EDGE_LABEL,
  MAX_ICON,
  MAX_NAME,
  MAX_NODE_TEXT,
  MAX_SHAPE_LABEL,
  MAX_TEXT_SIZE,
  MAX_TITLE,
  MIN_TEXT_SIZE,
  SHAPE_KINDS,
  TEXT_ALIGNS,
  TEXT_WEIGHTS,
  type ColorToken,
  type EdgeSemantic,
  type HexColor,
  type ShapeKind,
  type TextNode,
} from '@/domain/board';
import { TEMPER_TOKENS, isColorToken, normalizeHex } from '@/lib/colors';

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

/** Free text on the canvas. `text` is required, but may be empty. */
export interface KartaImportText {
  key?: string;
  text: string;
  /** px at zoom 1. Out-of-range values fall back to the default with a warning. */
  fontSize?: number;
  align?: TextNode['align'];
  weight?: TextNode['weight'];
  position?: { x: number; y: number };
  /** The ink, not a background. */
  color?: ColorToken | HexColor;
}

/** A draw.io shape. Only `shape` is required. */
export interface KartaImportShape {
  key?: string;
  shape: ShapeKind;
  label?: string;
  /** Omit for an outline-only shape. */
  fill?: ColorToken | HexColor;
  stroke?: ColorToken | HexColor;
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
  texts?: KartaImportText[];
  shapes?: KartaImportShape[];
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

/**
 * Length caps, read from `src/domain/board.ts` — the same constants
 * `api/src/domain/validate.ts` judges a save by, not a second copy of the
 * numbers. They are enforced here because the API enforces them at save time:
 * a value the importer waves through is a board that looks fine on screen and
 * that every autosave from then on rejects (spec 5.6). Overlong text is cut
 * with a warning — a value problem degrades, it does not fail the import.
 */
export const IMPORT_LIMITS = {
  /** Card title, group title, edge reference. */
  title: MAX_TITLE,
  /** Status and label names. */
  name: MAX_NAME,
  /** Card body — markdown. */
  body: MAX_CARD_BODY,
  checklistText: MAX_CHECKLIST_TEXT,
  /** Note text, and the body of a text node. */
  noteText: MAX_NODE_TEXT,
  edgeLabel: MAX_EDGE_LABEL,
  icon: MAX_ICON,
  /** A shape's centred caption — shorter than a title on purpose. */
  shapeLabel: MAX_SHAPE_LABEL,
} as const;

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
const TEXT_KEYS = new Set(['key', 'text', 'fontSize', 'align', 'weight', 'position', 'color']);
const SHAPE_KEYS = new Set(['key', 'shape', 'label', 'fill', 'stroke', 'position']);
const EDGE_KEYS = new Set(['from', 'to', 'semantic', 'label']);
const ROOT_KEYS = new Set([
  'kartaVersion',
  'board',
  'statuses',
  'labels',
  'cards',
  'notes',
  'texts',
  'shapes',
  'edges',
]);

/** The portable arrays that carry nodes — see {@link looksLikeBoardDoc}. */
const NODE_ARRAY_KEYS = ['cards', 'notes', 'texts', 'shapes'] as const;

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

/**
 * Cut an overlong value down to what the API will store, rather than letting
 * the user discover the limit as a save that fails forever.
 */
function truncate(p: Problems, value: string, path: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // never split a surrogate pair
  p.warn(`${path} is longer than ${max} characters and was shortened.`);
  return cut.trimEnd();
}

/**
 * @param options.required  a missing or non-string value is an error
 * @param options.allowEmpty an explicitly empty string is kept as `''` rather
 *   than dropped — a card whose title the user cleared, or an untouched sticky
 *   note, must survive its own backup
 * @param options.max       longer values are truncated with a warning
 */
function readString(
  p: Problems,
  value: unknown,
  path: string,
  options: { required?: boolean; allowEmpty?: boolean; max?: number } = {},
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
    if (options.allowEmpty) return '';
    if (options.required) p.error(`${path} cannot be empty.`);
    return undefined;
  }
  return options.max === undefined ? trimmed : truncate(p, trimmed, path, options.max);
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

/**
 * Tokens and hex are both allowed. Hex arrives in whatever shape it was
 * written — `#f00`, `F00`, `#FF0000` — and leaves as the one shape the
 * document may carry, `#ff0000`; anything else is dropped with a warning.
 */
function readColor(p: Problems, value: unknown, path: string): ColorToken | HexColor | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    p.warn(`${path} must be a colour name and was ignored.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (isColorToken(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (isColorToken(lower)) return lower;
  const hex = normalizeHex(trimmed);
  if (hex) return hex;
  p.warn(
    `${path} "${trimmed}" is not a Karta colour (${COLOR_LIST}, #RRGGBB or #RGB) and was ignored.`,
  );
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

/**
 * One of a fixed set, matched case-insensitively. A value that is not in the
 * set warns and returns `undefined`, so the caller's default — the one named
 * in the warning — applies. Missing is only a problem where it is required.
 */
function readChoice<T extends string>(
  p: Problems,
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback: T,
  options: { required?: boolean } = {},
): T | undefined {
  const raw = readString(p, value, path, { required: options.required });
  if (raw === undefined) return undefined;
  const match = allowed.find((option) => option.toLowerCase() === raw.toLowerCase());
  if (match !== undefined) return match;
  p.warn(`${path} "${raw}" is not one of ${allowed.join(', ')}; "${fallback}" was used.`);
  return undefined;
}

/**
 * A text node's size in canvas pixels. Out of range is a warning, not an
 * error: the node is still text, and the API would refuse the document.
 */
function readFontSize(p: Problems, value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    p.warn(`${path} must be a number of pixels and was ignored.`);
    return undefined;
  }
  if (value < MIN_TEXT_SIZE || value > MAX_TEXT_SIZE) {
    p.warn(`${path} must be between ${MIN_TEXT_SIZE} and ${MAX_TEXT_SIZE}; the default was used.`);
    return undefined;
  }
  return value;
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

/**
 * A full board export, as opposed to the portable shape. The decision is made
 * on which array actually carries the content: an object that announces the
 * portable format, or whose `cards`/`notes` hold what its `nodes` do not, is
 * read as portable however many stray keys it has. Guessing wrong here loses
 * every card silently, so it errs towards the shape that has something in it.
 */
function looksLikeBoardDoc(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.nodes)) return false;
  if (value.kartaVersion !== undefined) return false; // it says it is portable

  const portable: unknown[][] = [];
  for (const key of NODE_ARRAY_KEYS) {
    const list = value[key];
    if (Array.isArray(list)) portable.push(list);
  }
  if (portable.length > 0) {
    if (value.nodes.length === 0) return false; // nothing to read from `nodes`
    if (portable.some((list) => list.length > 0)) return false;
  }
  return typeof value.schemaVersion === 'number' || Array.isArray(value.statuses);
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
  const texts: Record<string, unknown>[] = [];
  const shapes: Record<string, unknown>[] = [];
  let skipped = 0;

  const handle = (node: Record<string, unknown>): string | undefined =>
    typeof node.id === 'string' ? node.id : undefined;

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
        key: handle(node),
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
        key: handle(node),
        text: node.text,
        color: node.color ?? undefined,
        position: node.position,
      });
    } else if (node.kind === 'text') {
      texts.push({
        key: handle(node),
        text: node.text,
        fontSize: node.fontSize,
        align: node.align,
        weight: node.weight,
        color: node.color ?? undefined,
        position: node.position,
      });
    } else if (node.kind === 'shape') {
      shapes.push({
        key: handle(node),
        shape: node.shape,
        label: node.label,
        fill: node.fill ?? undefined,
        stroke: node.stroke ?? undefined,
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
    texts,
    shapes,
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

/**
 * Claim an import-local handle. Cards, notes, texts and shapes share one key
 * namespace — an edge names a key, not a list — so the first claimant keeps it
 * and every later one is warned about in the same words.
 *
 * Keys are only capped where a title is: an edge naming a long title must
 * still resolve to it.
 */
function claimKey(p: Problems, keys: Set<string>, value: unknown, path: string): string | undefined {
  const key = readString(p, value, `${path}.key`, { max: IMPORT_LIMITS.title });
  if (key === undefined) return undefined;
  if (keys.has(key)) {
    p.warn(`${path}.key "${key}" is already used; edges may attach to the wrong node.`);
  }
  keys.add(key);
  return key;
}

function validateStatuses(p: Problems, raw: unknown): KartaImportStatus[] | undefined {
  const list = readArray(p, raw, 'statuses');
  if (!list) return undefined;

  const out: KartaImportStatus[] = [];
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const path = `statuses[${i}]`;
    if (!isRecord(entry)) {
      const name = readString(p, entry, path, { required: true, max: IMPORT_LIMITS.name });
      if (name) out.push({ name });
      return;
    }
    unknownKeys(p, entry, path, STATUS_KEYS);
    const name = readString(p, entry.name, `${path}.name`, {
      required: true,
      max: IMPORT_LIMITS.name,
    });
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
      max: IMPORT_LIMITS.name,
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
    // Both forms treat an empty item the same way: it is kept, because a card
    // on the board can hold one and a backup has to restore it.
    if (typeof entry === 'string') {
      const text = readString(p, entry, itemPath, {
        allowEmpty: true,
        max: IMPORT_LIMITS.checklistText,
      });
      if (text !== undefined) out.push({ text, done: false });
      return;
    }
    if (!isRecord(entry)) {
      p.error(`${itemPath} must be text, or an object like { "text": "…", "done": false }.`);
      return;
    }
    unknownKeys(p, entry, itemPath, new Set(['text', 'done']));
    const text = readString(p, entry.text, `${itemPath}.text`, {
      required: true,
      allowEmpty: true,
      max: IMPORT_LIMITS.checklistText,
    });
    if (text === undefined) return;
    out.push({ text, done: readBoolean(p, entry.done, `${itemPath}.done`) ?? false });
  });
  return out;
}

/** @param keys the one key namespace shared with {@link validateNotes}. */
function validateCards(p: Problems, raw: unknown, keys: Set<string>): KartaImportCard[] | undefined {
  const list = readArray(p, raw, 'cards');
  if (!list) return undefined;

  const out: KartaImportCard[] = [];
  list.forEach((entry, i) => {
    const path = `cards[${i}]`;
    if (typeof entry === 'string') {
      const title = readString(p, entry, path, {
        required: true,
        allowEmpty: true,
        max: IMPORT_LIMITS.title,
      });
      if (title !== undefined) out.push({ title });
      return;
    }
    if (!isRecord(entry)) {
      p.error(`${path} must be an object with a title.`);
      return;
    }
    unknownKeys(p, entry, path, CARD_KEYS);

    // A title must be *there*, but it may be empty: the card editor lets one
    // be cleared, and the board's own backup has to be readable again.
    const title = readString(p, entry.title, `${path}.title`, {
      required: true,
      allowEmpty: true,
      max: IMPORT_LIMITS.title,
    });
    if (title === undefined) return;

    const key = claimKey(p, keys, entry.key, path);

    // Markdown keeps its whitespace — trimming a body would eat its layout.
    let body: string | undefined;
    if (entry.body !== undefined && entry.body !== null) {
      if (typeof entry.body !== 'string') p.error(`${path}.body must be text.`);
      else if (entry.body.length > 0) {
        body = truncate(p, entry.body, `${path}.body`, IMPORT_LIMITS.body);
      }
    }

    out.push({
      key,
      title,
      body,
      status: readString(p, entry.status, `${path}.status`, { max: IMPORT_LIMITS.name }),
      labels: validateCardLabels(p, entry.labels, path),
      checklist: validateChecklist(p, entry.checklist, `${path}.checklist`),
      color: readColor(p, entry.color, `${path}.color`),
      due: readDue(p, entry.due, `${path}.due`),
      position: readPosition(p, entry.position, `${path}.position`),
      collapsed: readBoolean(p, entry.collapsed, `${path}.collapsed`),
    });
  });
  return out;
}

/**
 * The names on one card. Repeats are dropped case-insensitively — the same
 * rule the top-level `labels` list follows — because they all resolve to one
 * label, and a card holding the same label id three times renders the chip
 * three times and lies about how many are hidden.
 */
function validateCardLabels(p: Problems, raw: unknown, path: string): string[] | undefined {
  const list = readArray(p, raw, `${path}.labels`);
  if (!list) return undefined;

  const out: string[] = [];
  const seen = new Set<string>();
  list.forEach((entry, j) => {
    const name = readString(p, entry, `${path}.labels[${j}]`, {
      required: true,
      max: IMPORT_LIMITS.name,
    });
    if (name === undefined) return;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      p.warn(`${path}.labels "${name}" appears twice on the same card; the duplicate was ignored.`);
      return;
    }
    seen.add(key);
    out.push(name);
  });
  return out.length > 0 ? out : undefined;
}

/** @param keys the one key namespace shared with {@link validateCards}. */
function validateNotes(p: Problems, raw: unknown, keys: Set<string>): KartaImportNote[] | undefined {
  const list = readArray(p, raw, 'notes');
  if (!list) return undefined;

  const out: KartaImportNote[] = [];
  list.forEach((entry, i) => {
    const path = `notes[${i}]`;
    if (typeof entry === 'string') {
      const text = readString(p, entry, path, {
        required: true,
        allowEmpty: true,
        max: IMPORT_LIMITS.noteText,
      });
      if (text !== undefined) out.push({ text });
      return;
    }
    if (!isRecord(entry)) {
      p.error(`${path} must be an object with text.`);
      return;
    }
    unknownKeys(p, entry, path, NOTE_KEYS);
    // An untouched sticky note has no text at all; it is still a note.
    const text = readString(p, entry.text, `${path}.text`, {
      required: true,
      allowEmpty: true,
      max: IMPORT_LIMITS.noteText,
    });
    if (text === undefined) return;

    out.push({
      key: claimKey(p, keys, entry.key, path),
      text,
      color: readColor(p, entry.color, `${path}.color`),
      position: readPosition(p, entry.position, `${path}.position`),
    });
  });
  return out;
}

/** @param keys the one key namespace shared with {@link validateCards}. */
function validateTexts(p: Problems, raw: unknown, keys: Set<string>): KartaImportText[] | undefined {
  const list = readArray(p, raw, 'texts');
  if (!list) return undefined;

  const out: KartaImportText[] = [];
  list.forEach((entry, i) => {
    const path = `texts[${i}]`;
    if (typeof entry === 'string') {
      const text = readString(p, entry, path, {
        required: true,
        allowEmpty: true,
        max: IMPORT_LIMITS.noteText,
      });
      if (text !== undefined) out.push({ text });
      return;
    }
    if (!isRecord(entry)) {
      p.error(`${path} must be an object with text.`);
      return;
    }
    unknownKeys(p, entry, path, TEXT_KEYS);
    // A text box created and not yet typed into is empty, and has to survive
    // its own backup exactly as an untouched sticky note does.
    const text = readString(p, entry.text, `${path}.text`, {
      required: true,
      allowEmpty: true,
      max: IMPORT_LIMITS.noteText,
    });
    if (text === undefined) return;

    out.push({
      key: claimKey(p, keys, entry.key, path),
      text,
      fontSize: readFontSize(p, entry.fontSize, `${path}.fontSize`),
      align: readChoice(p, entry.align, `${path}.align`, TEXT_ALIGNS, 'left'),
      weight: readChoice(p, entry.weight, `${path}.weight`, TEXT_WEIGHTS, 'regular'),
      position: readPosition(p, entry.position, `${path}.position`),
      color: readColor(p, entry.color, `${path}.color`),
    });
  });
  return out;
}

/** @param keys the one key namespace shared with {@link validateCards}. */
function validateShapes(p: Problems, raw: unknown, keys: Set<string>): KartaImportShape[] | undefined {
  const list = readArray(p, raw, 'shapes');
  if (!list) return undefined;

  const out: KartaImportShape[] = [];
  list.forEach((entry, i) => {
    const path = `shapes[${i}]`;
    // The bare form is the shape name itself: "shapes": ["diamond", "cloud"].
    const record = isRecord(entry) ? entry : null;
    if (!record && typeof entry !== 'string') {
      p.error(`${path} must be a shape name, or an object like { "shape": "diamond" }.`);
      return;
    }
    if (record) unknownKeys(p, record, path, SHAPE_KEYS);

    // A missing shape is an error; an unrecognised one is a warning and a
    // rectangle, so a model inventing "octagon" still lands a node.
    const shape =
      readChoice(
        p,
        record ? record.shape : entry,
        record ? `${path}.shape` : path,
        SHAPE_KINDS,
        'rectangle',
        { required: true },
      ) ?? 'rectangle';

    if (!record) {
      out.push({ shape });
      return;
    }

    out.push({
      key: claimKey(p, keys, record.key, path),
      shape,
      // A shape's own cap, not a title's: they are the same number today, and
      // the field that must not drift is the one the shape editor types into.
      label: readString(p, record.label, `${path}.label`, {
        allowEmpty: true,
        max: IMPORT_LIMITS.shapeLabel,
      }),
      fill: readColor(p, record.fill, `${path}.fill`),
      stroke: readColor(p, record.stroke, `${path}.stroke`),
      position: readPosition(p, record.position, `${path}.position`),
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
    // Capped exactly as a title is, so a reference to a shortened title still
    // matches the card it was shortened into.
    const from = readString(p, entry.from, `${path}.from`, {
      required: true,
      max: IMPORT_LIMITS.title,
    });
    const to = readString(p, entry.to, `${path}.to`, { required: true, max: IMPORT_LIMITS.title });
    if (!from || !to) return;

    let semantic: EdgeSemantic | undefined;
    const rawSemantic = readString(p, entry.semantic, `${path}.semantic`);
    if (rawSemantic !== undefined) {
      const lower = rawSemantic.toLowerCase();
      if ((EDGE_SEMANTICS as readonly string[]).includes(lower)) semantic = lower as EdgeSemantic;
      else p.warn(`${path}.semantic "${rawSemantic}" is not one of ${SEMANTIC_LIST}; "relates" was used.`);
    }

    out.push({
      from,
      to,
      semantic,
      label: readString(p, entry.label, `${path}.label`, { max: IMPORT_LIMITS.edgeLabel }),
    });
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
  const title = readString(p, raw.title, 'board.title', { max: IMPORT_LIMITS.title });
  if (title !== undefined) board.title = title;
  if ('icon' in raw) {
    board.icon =
      typeof raw.icon === 'string' ? truncate(p, raw.icon, 'board.icon', IMPORT_LIMITS.icon) : null;
  }
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

  // Every node list shares one key namespace: an edge names a key, not a list.
  const keys = new Set<string>();

  const cards = validateCards(p, shape.cards, keys);
  if (cards && cards.length > 0) value.cards = cards;

  const notes = validateNotes(p, shape.notes, keys);
  if (notes && notes.length > 0) value.notes = notes;

  const texts = validateTexts(p, shape.texts, keys);
  if (texts && texts.length > 0) value.texts = texts;

  const shapes = validateShapes(p, shape.shapes, keys);
  if (shapes && shapes.length > 0) value.shapes = shapes;

  const edges = validateEdges(p, shape.edges);
  if (edges && edges.length > 0) value.edges = edges;

  const empty =
    !value.cards && !value.notes && !value.texts && !value.shapes && !value.statuses && !value.labels;
  if (p.errors.length === 0 && empty) {
    p.error('There is nothing to import — no cards, notes, text or shapes were found.');
  }

  if (p.errors.length > 0) return { ok: false, errors: cap(p.errors), warnings: p.warnings };
  return { ok: true, value, warnings: p.warnings };
}
