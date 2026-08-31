/**
 * Runtime validation of everything a client posts.
 *
 * The board document is a single JSON blob written wholesale, so the API is
 * the only thing standing between a buggy client and a corrupted board. These
 * are hand-written guards on purpose: a schema library is another dependency,
 * another bundle, and another dialect to keep in sync with the one type
 * contract in `src/domain/board.ts`.
 *
 * Two rules shape what is checked:
 *  - Structure is enforced hard. A node with a non-finite position or an edge
 *    pointing at a node that does not exist breaks the canvas for good.
 *  - Dangling *media* references are tolerated. A card that still names a
 *    deleted cover image renders without one; rejecting the write would trap
 *    the user in a save loop they cannot escape.
 */

import type {
  BoardDoc,
  ColorToken,
  Id,
  MediaContentType,
} from '../../../src/domain/board.js';
import {
  MAX_MEDIA_BYTES,
  MAX_SHAPE_LABEL,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  SHAPE_KINDS,
  SIZE_HARD_STOP_BYTES,
  SIZE_WARN_BYTES,
  SIZE_WARN_NODES,
  TEXT_ALIGNS,
  TEXT_WEIGHTS,
} from '../../../src/domain/board.js';
import { BadRequestError } from './errors.js';
import { upgradeToCurrent } from './migrate.js';
import type {
  CreateBoardRequest,
  MediaCommitRequest,
  PutBoardRequest,
  RestoreRequest,
  UploadUrlRequest,
} from './types.js';

/* ------------------------------------------------------------------ *
 * Primitive shapes
 * ------------------------------------------------------------------ */

/** Crockford base32, 26 chars — the shape `ulid()` produces. */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Ids that reach a blob name (board, media) must be exactly ULIDs. */
export function isUlid(v: unknown): v is Id {
  return typeof v === 'string' && ULID_RE.test(v);
}

/**
 * Ids that stay inside the document (nodes, edges, statuses, labels,
 * checklist items). Imported documents may carry ids the app did not mint, so
 * the rule is "safe and bounded" rather than "ULID".
 */
const LOCAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const isLocalId = (v: unknown): v is Id => typeof v === 'string' && LOCAL_ID_RE.test(v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFinite_ = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const COLOR_TOKENS: readonly ColorToken[] = [
  'straw',
  'bronze',
  'copper',
  'purple',
  'blue',
  'teal',
  'slate',
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const HANDLES = ['top', 'right', 'bottom', 'left'] as const;
const SEMANTICS = ['relates', 'depends', 'blocks', 'derives'] as const;
const ROUTINGS = ['bezier', 'smoothstep', 'straight'] as const;
const FITS = ['contain', 'cover'] as const;

/** The node kinds this build understands, for the error a bad `kind` produces. */
const NODE_KINDS = ['card', 'image', 'note', 'boardLink', 'group', 'text', 'shape'] as const;

export const MEDIA_CONTENT_TYPES: readonly MediaContentType[] = [
  'image/webp',
  'image/png',
  'image/jpeg',
];

/** `{iso, colon-free}.json` — see `BlobBoardStore.snapshot`. */
export const SNAPSHOT_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

export const isSnapshotName = (v: unknown): v is string =>
  typeof v === 'string' && SNAPSHOT_NAME_RE.test(v);

/**
 * Container-inclusive media blob path, e.g. `media/{boardId}/{mediaId}.webp`
 * or its `.thumb.webp` sibling. The board id segment must be the board being
 * written: the orphan list is a delete instruction, so it may never be able to
 * name a blob outside the caller's own board.
 */
const MEDIA_PATH_RE =
  /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\/([0-9A-HJKMNP-TV-Z]{26})\/([0-9A-HJKMNP-TV-Z]{26})(\.thumb)?\.(webp|png|jpg|jpeg)$/;

export function isSafeMediaPath(path: unknown, boardId: Id): boolean {
  if (typeof path !== 'string') return false;
  const m = MEDIA_PATH_RE.exec(path);
  return m !== null && m[2] === boardId;
}

/* ------------------------------------------------------------------ *
 * Error collection
 * ------------------------------------------------------------------ */

const MAX_ERRORS = 50;

class ErrorBag {
  private readonly items: string[] = [];
  private truncated = false;

  add(path: string, message: string): void {
    if (this.items.length >= MAX_ERRORS) {
      this.truncated = true;
      return;
    }
    this.items.push(`${path}: ${message}`);
  }

  get empty(): boolean {
    return this.items.length === 0;
  }

  drain(): string[] {
    return this.truncated
      ? [...this.items, `… further problems omitted (first ${MAX_ERRORS} shown)`]
      : [...this.items];
  }
}

/* ------------------------------------------------------------------ *
 * Field checks
 * ------------------------------------------------------------------ */

function checkString(e: ErrorBag, path: string, v: unknown, maxLength: number): boolean {
  if (typeof v !== 'string') {
    e.add(path, 'expected a string');
    return false;
  }
  if (v.length > maxLength) {
    e.add(path, `longer than ${maxLength} characters`);
    return false;
  }
  return true;
}

function checkNullableString(e: ErrorBag, path: string, v: unknown, maxLength: number): void {
  if (v === null) return;
  checkString(e, path, v, maxLength);
}

function checkBool(e: ErrorBag, path: string, v: unknown): void {
  if (typeof v !== 'boolean') e.add(path, 'expected a boolean');
}

function checkNumber(e: ErrorBag, path: string, v: unknown): void {
  if (!isFinite_(v)) e.add(path, 'expected a finite number');
}

function checkIso(e: ErrorBag, path: string, v: unknown): void {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    e.add(path, 'expected an ISO 8601 timestamp');
  }
}

function checkNullableIso(e: ErrorBag, path: string, v: unknown): void {
  if (v === null) return;
  checkIso(e, path, v);
}

function checkColor(e: ErrorBag, path: string, v: unknown): void {
  if (v === null) return;
  if (typeof v === 'string' && (COLOR_TOKENS.includes(v as ColorToken) || HEX_RE.test(v))) return;
  e.add(path, 'expected a colour token or #RRGGBB');
}

function checkColorToken(e: ErrorBag, path: string, v: unknown): void {
  if (typeof v !== 'string' || !COLOR_TOKENS.includes(v as ColorToken)) {
    e.add(path, `expected one of ${COLOR_TOKENS.join(', ')}`);
  }
}

function checkVec(e: ErrorBag, path: string, v: unknown, a: string, b: string): void {
  if (!isRecord(v)) {
    e.add(path, 'expected an object');
    return;
  }
  checkNumber(e, `${path}.${a}`, v[a]);
  checkNumber(e, `${path}.${b}`, v[b]);
}

function checkEnum<T extends string>(
  e: ErrorBag,
  path: string,
  v: unknown,
  allowed: readonly T[],
): void {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    e.add(path, `expected one of ${allowed.join(', ')}`);
  }
}

function checkLocalId(e: ErrorBag, path: string, v: unknown): void {
  if (!isLocalId(v)) e.add(path, 'expected an id of 1-64 url-safe characters');
}

function readArray(e: ErrorBag, path: string, v: unknown): unknown[] {
  if (!Array.isArray(v)) {
    e.add(path, 'expected an array');
    return [];
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * Board document
 * ------------------------------------------------------------------ */

export type BoardDocValidation =
  | { ok: true; errors: string[]; doc: BoardDoc }
  | { ok: false; errors: string[]; doc: null };

const MAX_TITLE = 300;
const MAX_NAME = 120;
const MAX_LABEL = 300;
const MAX_CHECKLIST_TEXT = 2000;
/** Note and text-node bodies. */
const MAX_NODE_TEXT = 20000;
const MAX_RANK = 64;

/**
 * Check a document a client posted, and hand back the version this build
 * stores.
 *
 * The write path is exactly as tolerant as the read path: the input is walked
 * forward by the same migration steps `migrate` uses, and only then judged.
 * Demanding the current version outright looks stricter and is in fact a trap
 * — a client that recovers a document written by the previous deploy (its
 * write-ahead log survives a release) would have every save it ever makes
 * refused, with no way out from inside the app. Anything this API can read, it
 * can be handed back.
 */
export function validateBoardDoc(input: unknown): BoardDocValidation {
  const e = new ErrorBag();

  if (!isRecord(input)) {
    return { ok: false, errors: ['doc: expected a JSON object'], doc: null };
  }

  let raw: Record<string, unknown>;
  try {
    raw = upgradeToCurrent(input);
  } catch (err) {
    // A version this build cannot read. Migration steps are total by contract
    // (see `migrate.ts`), so anything else that lands here is a bug in one —
    // and it degrades to "this document cannot be read", never to a 500.
    const reason = err instanceof Error ? err.message : 'unreadable schemaVersion';
    return { ok: false, errors: [`doc.schemaVersion: ${reason}`], doc: null };
  }

  if (!isUlid(raw['id'])) e.add('doc.id', 'expected a ULID');
  if (raw['parentBoardId'] !== null && !isUlid(raw['parentBoardId'])) {
    e.add('doc.parentBoardId', 'expected a ULID or null');
  }
  checkString(e, 'doc.title', raw['title'], MAX_TITLE);
  checkNullableString(e, 'doc.icon', raw['icon'], 64);
  checkIso(e, 'doc.createdAt', raw['createdAt']);
  checkIso(e, 'doc.updatedAt', raw['updatedAt']);
  checkNullableIso(e, 'doc.deletedAt', raw['deletedAt']);
  checkAcl(e, raw['acl']);
  checkViewport(e, raw['viewport']);

  const statusIds = checkStatuses(e, raw['statuses']);
  const labelIds = checkLabels(e, raw['labels']);
  checkMedia(e, raw['media']);
  const nodeIds = checkNodes(e, raw['nodes'], statusIds, labelIds);
  checkEdges(e, raw['edges'], nodeIds);

  if (!e.empty) return { ok: false, errors: e.drain(), doc: null };
  return { ok: true, errors: [], doc: raw as unknown as BoardDoc };
}

function checkAcl(e: ErrorBag, v: unknown): void {
  if (!isRecord(v)) {
    e.add('doc.acl', 'expected an object');
    return;
  }
  if (typeof v['ownerId'] !== 'string' || v['ownerId'].length === 0) {
    e.add('doc.acl.ownerId', 'expected a non-empty string');
  }
  for (const key of ['editorIds', 'viewerIds'] as const) {
    const list = readArray(e, `doc.acl.${key}`, v[key]);
    list.forEach((entry, i) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        e.add(`doc.acl.${key}[${i}]`, 'expected a non-empty string');
      }
    });
  }
}

function checkViewport(e: ErrorBag, v: unknown): void {
  if (!isRecord(v)) {
    e.add('doc.viewport', 'expected an object');
    return;
  }
  checkNumber(e, 'doc.viewport.x', v['x']);
  checkNumber(e, 'doc.viewport.y', v['y']);
  if (!isFinite_(v['zoom']) || v['zoom'] <= 0) {
    e.add('doc.viewport.zoom', 'expected a positive finite number');
  }
}

function checkStatuses(e: ErrorBag, v: unknown): Set<Id> {
  const list = readArray(e, 'doc.statuses', v);
  const ids = new Set<Id>();
  list.forEach((entry, i) => {
    const p = `doc.statuses[${i}]`;
    if (!isRecord(entry)) {
      e.add(p, 'expected an object');
      return;
    }
    checkLocalId(e, `${p}.id`, entry['id']);
    if (isLocalId(entry['id'])) {
      if (ids.has(entry['id'])) e.add(`${p}.id`, 'duplicate status id');
      ids.add(entry['id']);
    }
    checkString(e, `${p}.name`, entry['name'], MAX_NAME);
    checkColorToken(e, `${p}.color`, entry['color']);
    checkNumber(e, `${p}.order`, entry['order']);
    checkBool(e, `${p}.isDone`, entry['isDone']);
  });
  return ids;
}

function checkLabels(e: ErrorBag, v: unknown): Set<Id> {
  const list = readArray(e, 'doc.labels', v);
  const ids = new Set<Id>();
  list.forEach((entry, i) => {
    const p = `doc.labels[${i}]`;
    if (!isRecord(entry)) {
      e.add(p, 'expected an object');
      return;
    }
    checkLocalId(e, `${p}.id`, entry['id']);
    if (isLocalId(entry['id'])) {
      if (ids.has(entry['id'])) e.add(`${p}.id`, 'duplicate label id');
      ids.add(entry['id']);
    }
    checkString(e, `${p}.name`, entry['name'], MAX_NAME);
    checkColorToken(e, `${p}.color`, entry['color']);
  });
  return ids;
}

function checkMedia(e: ErrorBag, v: unknown): void {
  const list = readArray(e, 'doc.media', v);
  const ids = new Set<Id>();
  list.forEach((entry, i) => {
    const p = `doc.media[${i}]`;
    if (!isRecord(entry)) {
      e.add(p, 'expected an object');
      return;
    }
    if (!isUlid(entry['id'])) {
      e.add(`${p}.id`, 'expected a ULID');
    } else {
      if (ids.has(entry['id'])) e.add(`${p}.id`, 'duplicate media id');
      ids.add(entry['id']);
    }
    checkString(e, `${p}.blobPath`, entry['blobPath'], 256);
    checkString(e, `${p}.thumbPath`, entry['thumbPath'], 256);
    checkEnum(e, `${p}.contentType`, entry['contentType'], MEDIA_CONTENT_TYPES);
    checkNumber(e, `${p}.bytes`, entry['bytes']);
    checkNumber(e, `${p}.width`, entry['width']);
    checkNumber(e, `${p}.height`, entry['height']);
    checkIso(e, `${p}.uploadedAt`, entry['uploadedAt']);
    checkString(e, `${p}.uploadedBy`, entry['uploadedBy'], 200);
  });
}

function checkNodeBase(e: ErrorBag, p: string, n: Record<string, unknown>): void {
  checkLocalId(e, `${p}.id`, n['id']);
  checkVec(e, `${p}.position`, n['position'], 'x', 'y');
  checkVec(e, `${p}.size`, n['size'], 'w', 'h');
  checkNumber(e, `${p}.z`, n['z']);
  checkColor(e, `${p}.color`, n['color']);
  checkIso(e, `${p}.createdAt`, n['createdAt']);
  checkIso(e, `${p}.updatedAt`, n['updatedAt']);
  checkString(e, `${p}.updatedBy`, n['updatedBy'], 200);
  checkBool(e, `${p}.locked`, n['locked']);
}

function checkNodes(
  e: ErrorBag,
  v: unknown,
  statusIds: Set<Id>,
  labelIds: Set<Id>,
): Set<Id> {
  const list = readArray(e, 'doc.nodes', v);
  const ids = new Set<Id>();

  list.forEach((entry, i) => {
    const p = `doc.nodes[${i}]`;
    if (!isRecord(entry)) {
      e.add(p, 'expected an object');
      return;
    }
    checkNodeBase(e, p, entry);
    if (isLocalId(entry['id'])) {
      if (ids.has(entry['id'])) e.add(`${p}.id`, 'duplicate node id');
      ids.add(entry['id']);
    }

    switch (entry['kind']) {
      case 'card':
        checkCard(e, p, entry, statusIds, labelIds);
        break;
      case 'image':
        checkImage(e, p, entry);
        break;
      case 'note':
        checkString(e, `${p}.text`, entry['text'], MAX_NODE_TEXT);
        break;
      case 'boardLink':
        checkBoardLink(e, p, entry);
        break;
      case 'group':
        checkString(e, `${p}.title`, entry['title'], MAX_TITLE);
        checkNumber(e, `${p}.padding`, entry['padding']);
        break;
      case 'text':
        checkText(e, p, entry);
        break;
      case 'shape':
        checkShape(e, p, entry);
        break;
      default:
        e.add(`${p}.kind`, `expected one of ${NODE_KINDS.join(', ')}`);
    }
  });

  return ids;
}

function checkCard(
  e: ErrorBag,
  p: string,
  n: Record<string, unknown>,
  statusIds: Set<Id>,
  labelIds: Set<Id>,
): void {
  checkString(e, `${p}.title`, n['title'], MAX_TITLE);
  checkString(e, `${p}.body`, n['body'], 200000);
  checkString(e, `${p}.rank`, n['rank'], MAX_RANK);
  checkBool(e, `${p}.collapsed`, n['collapsed']);
  checkNullableIso(e, `${p}.dueDate`, n['dueDate']);

  if (n['statusId'] !== null) {
    if (!isLocalId(n['statusId'])) {
      e.add(`${p}.statusId`, 'expected an id or null');
    } else if (!statusIds.has(n['statusId'])) {
      e.add(`${p}.statusId`, `references unknown status "${n['statusId']}"`);
    }
  }

  if (n['coverMediaId'] !== null && !isLocalId(n['coverMediaId'])) {
    e.add(`${p}.coverMediaId`, 'expected an id or null');
  }

  const labels = readArray(e, `${p}.labelIds`, n['labelIds']);
  labels.forEach((id, j) => {
    if (!isLocalId(id)) {
      e.add(`${p}.labelIds[${j}]`, 'expected an id');
    } else if (!labelIds.has(id)) {
      e.add(`${p}.labelIds[${j}]`, `references unknown label "${id}"`);
    }
  });

  const checklist = readArray(e, `${p}.checklist`, n['checklist']);
  const seen = new Set<Id>();
  checklist.forEach((item, j) => {
    const q = `${p}.checklist[${j}]`;
    if (!isRecord(item)) {
      e.add(q, 'expected an object');
      return;
    }
    checkLocalId(e, `${q}.id`, item['id']);
    if (isLocalId(item['id'])) {
      if (seen.has(item['id'])) e.add(`${q}.id`, 'duplicate checklist item id');
      seen.add(item['id']);
    }
    checkString(e, `${q}.text`, item['text'], MAX_CHECKLIST_TEXT);
    checkBool(e, `${q}.done`, item['done']);
    checkString(e, `${q}.rank`, item['rank'], MAX_RANK);
  });
}

function checkImage(e: ErrorBag, p: string, n: Record<string, unknown>): void {
  checkLocalId(e, `${p}.mediaId`, n['mediaId']);
  checkVec(e, `${p}.naturalSize`, n['naturalSize'], 'w', 'h');
  checkNullableString(e, `${p}.caption`, n['caption'], MAX_LABEL);
  checkEnum(e, `${p}.fit`, n['fit'], FITS);
}

function checkText(e: ErrorBag, p: string, n: Record<string, unknown>): void {
  checkString(e, `${p}.text`, n['text'], MAX_NODE_TEXT);
  // A font size is geometry, not decoration: NaN or 10^6 is a node that cannot
  // be drawn or cannot be escaped, and both survive a JSON round trip.
  const size = n['fontSize'];
  if (!isFinite_(size) || size < MIN_TEXT_SIZE || size > MAX_TEXT_SIZE) {
    e.add(`${p}.fontSize`, `expected a number between ${MIN_TEXT_SIZE} and ${MAX_TEXT_SIZE}`);
  }
  checkEnum(e, `${p}.align`, n['align'], TEXT_ALIGNS);
  checkEnum(e, `${p}.weight`, n['weight'], TEXT_WEIGHTS);
}

function checkShape(e: ErrorBag, p: string, n: Record<string, unknown>): void {
  checkEnum(e, `${p}.shape`, n['shape'], SHAPE_KINDS);
  // The same number the editor caps its field at, read from the one contract —
  // a label the client will happily type and the server refuses is a board
  // that can never be saved again.
  checkString(e, `${p}.label`, n['label'], MAX_SHAPE_LABEL);
  // Same rule as every other colour field, through the same helper: a hex the
  // client accepts and the server refuses is a board that can never be saved.
  checkColor(e, `${p}.fill`, n['fill']);
  checkColor(e, `${p}.stroke`, n['stroke']);
}

function checkBoardLink(e: ErrorBag, p: string, n: Record<string, unknown>): void {
  if (!isUlid(n['targetBoardId'])) e.add(`${p}.targetBoardId`, 'expected a ULID');
  checkString(e, `${p}.cachedTitle`, n['cachedTitle'], MAX_TITLE);
  const counts = n['cachedCounts'];
  if (counts !== null) {
    if (!isRecord(counts)) {
      e.add(`${p}.cachedCounts`, 'expected an object or null');
    } else {
      checkNumber(e, `${p}.cachedCounts.total`, counts['total']);
      checkNumber(e, `${p}.cachedCounts.done`, counts['done']);
    }
  }
}

function checkEdges(e: ErrorBag, v: unknown, nodeIds: Set<Id>): void {
  const list = readArray(e, 'doc.edges', v);
  const ids = new Set<Id>();
  list.forEach((entry, i) => {
    const p = `doc.edges[${i}]`;
    if (!isRecord(entry)) {
      e.add(p, 'expected an object');
      return;
    }
    checkLocalId(e, `${p}.id`, entry['id']);
    if (isLocalId(entry['id'])) {
      if (ids.has(entry['id'])) e.add(`${p}.id`, 'duplicate edge id');
      ids.add(entry['id']);
    }
    for (const end of ['source', 'target'] as const) {
      const id = entry[end];
      if (!isLocalId(id)) {
        e.add(`${p}.${end}`, 'expected a node id');
      } else if (!nodeIds.has(id)) {
        e.add(`${p}.${end}`, `references unknown node "${id}"`);
      }
    }
    checkEnum(e, `${p}.sourceHandle`, entry['sourceHandle'], HANDLES);
    checkEnum(e, `${p}.targetHandle`, entry['targetHandle'], HANDLES);
    checkEnum(e, `${p}.semantic`, entry['semantic'], SEMANTICS);
    checkEnum(e, `${p}.routing`, entry['routing'], ROUTINGS);
    checkNullableString(e, `${p}.label`, entry['label'], MAX_LABEL);
    checkColor(e, `${p}.color`, entry['color']);
    checkIso(e, `${p}.updatedAt`, entry['updatedAt']);
  });
}

/* ------------------------------------------------------------------ *
 * Size budget — spec 5.6
 * ------------------------------------------------------------------ */

export interface SizeBudgetResult {
  level: 'ok' | 'warn' | 'reject';
  message?: string;
}

const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

/**
 * Warn at 300 nodes or 400 KB, hard-stop at 1 MB. The reject message names the
 * way out rather than the rule that was broken.
 */
export function enforceSizeBudget(serialized: string, doc: BoardDoc): SizeBudgetResult {
  const bytes = Buffer.byteLength(serialized, 'utf8');
  const nodes = doc.nodes.length;

  if (bytes > SIZE_HARD_STOP_BYTES) {
    return {
      level: 'reject',
      message:
        `This board is ${kb(bytes)}, over the ${kb(SIZE_HARD_STOP_BYTES)} limit, and was not saved. ` +
        'Move a section of it onto a nested board — select those nodes and extract them to a child board — ' +
        'then save again. Your work is still here in the browser until you do.',
    };
  }

  if (nodes > SIZE_WARN_NODES || bytes > SIZE_WARN_BYTES) {
    return {
      level: 'warn',
      message:
        `This board has ${nodes} nodes and is ${kb(bytes)}. ` +
        'Boards stay fast under 300 nodes — consider splitting a section onto a nested board.',
    };
  }

  return { level: 'ok' };
}

/* ------------------------------------------------------------------ *
 * Request bodies
 * ------------------------------------------------------------------ */

function body(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) throw new BadRequestError('Expected a JSON object body.');
  return raw;
}

export function parseCreateBoardRequest(raw: unknown): CreateBoardRequest {
  const b = body(raw);
  const title = typeof b['title'] === 'string' ? b['title'].trim() : '';
  if (title.length === 0) throw new BadRequestError('A board needs a title.');
  if (title.length > MAX_TITLE) {
    throw new BadRequestError(`Title is longer than ${MAX_TITLE} characters.`);
  }
  const parent = b['parentBoardId'];
  if (parent !== undefined && parent !== null && !isUlid(parent)) {
    throw new BadRequestError('parentBoardId must be a board id or null.');
  }
  return { title, parentBoardId: isUlid(parent) ? parent : null };
}

const MAX_ORPHANS = 500;

export function parsePutBoardRequest(raw: unknown, boardId: Id): PutBoardRequest {
  const b = body(raw);

  const result = validateBoardDoc(b['doc']);
  if (!result.ok) {
    throw new BadRequestError('The board document is not valid.', result.errors);
  }
  if (result.doc.id !== boardId) {
    throw new BadRequestError('The document id does not match the board being written.');
  }

  const orphansRaw = b['orphanBlobPaths'];
  let orphanBlobPaths: string[] = [];
  if (orphansRaw !== undefined && orphansRaw !== null) {
    if (!Array.isArray(orphansRaw)) {
      throw new BadRequestError('orphanBlobPaths must be an array of blob paths.');
    }
    const entries = orphansRaw as unknown[];
    if (entries.length > MAX_ORPHANS) {
      throw new BadRequestError(`orphanBlobPaths holds more than ${MAX_ORPHANS} entries.`);
    }
    // Anything that is not a blob of this board is dropped, not rejected. A
    // board can legitimately hold MediaRefs minted under another board's
    // prefix — "extract to board" and "save a copy" both hand the new document
    // the parent's refs verbatim — and the client queues those exact paths when
    // such an image is deleted. Throwing would wedge the board: the save fails,
    // the client only clears its orphan queue on success, and every later
    // autosave repeats the same rejection. Dropping keeps the delete surface
    // strictly inside the caller's own board without ever blocking a write.
    orphanBlobPaths = entries.filter((path): path is string => isSafeMediaPath(path, boardId));
  }

  return { doc: result.doc, orphanBlobPaths };
}

export function parseRestoreRequest(raw: unknown): RestoreRequest {
  const b = body(raw);
  if (!isSnapshotName(b['snapshotName'])) {
    throw new BadRequestError('snapshotName is not a valid restore point name.');
  }
  return { snapshotName: b['snapshotName'] };
}

function positiveInt(raw: unknown, field: string, max: number): number {
  if (!isFinite_(raw) || !Number.isInteger(raw) || raw <= 0) {
    throw new BadRequestError(`${field} must be a positive integer.`);
  }
  if (raw > max) throw new BadRequestError(`${field} is larger than the limit of ${max}.`);
  return raw;
}

function contentType(raw: unknown): MediaContentType {
  if (typeof raw !== 'string' || !(MEDIA_CONTENT_TYPES as readonly string[]).includes(raw)) {
    throw new BadRequestError(`contentType must be one of ${MEDIA_CONTENT_TYPES.join(', ')}.`);
  }
  return raw as MediaContentType;
}

function ulidField(raw: unknown, field: string): Id {
  if (!isUlid(raw)) throw new BadRequestError(`${field} must be a board id.`);
  return raw;
}

/** Largest image edge accepted at commit — anything beyond is a client bug. */
const MAX_IMAGE_EDGE = 20000;

export function parseUploadUrlRequest(raw: unknown): UploadUrlRequest {
  const b = body(raw);
  return {
    boardId: ulidField(b['boardId'], 'boardId'),
    contentType: contentType(b['contentType']),
    bytes: positiveInt(b['bytes'], 'bytes', MAX_MEDIA_BYTES),
  };
}

export function parseMediaCommitRequest(raw: unknown): MediaCommitRequest {
  const b = body(raw);
  return {
    boardId: ulidField(b['boardId'], 'boardId'),
    mediaId: ulidField(b['mediaId'], 'mediaId'),
    width: positiveInt(b['width'], 'width', MAX_IMAGE_EDGE),
    height: positiveInt(b['height'], 'height', MAX_IMAGE_EDGE),
    bytes: positiveInt(b['bytes'], 'bytes', MAX_MEDIA_BYTES),
    contentType: contentType(b['contentType']),
  };
}
