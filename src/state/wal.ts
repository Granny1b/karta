import { del, get, set } from 'idb-keyval';
import { SCHEMA_VERSION, type BoardDoc, type Id, type Iso } from '@/domain/board';
import { nowIso } from '@/lib/format';

/**
 * Write-ahead log (spec 7.5). Every mutation lands here before the network is
 * touched, and the entry is cleared only after a 200 from `PUT`. IndexedDB can
 * be unavailable (private windows, blocked storage); losing the WAL degrades
 * durability but must never break editing, so every call is guarded.
 */

export interface WalEntry {
  boardId: Id;
  doc: BoardDoc;
  savedAt: Iso;
  /**
   * The ETag this entry was written against — the server version it edits on
   * top of. `null` when it is not known: no ETag was held yet, or the entry
   * comes from a build that did not record one.
   */
  etag: string | null;
}

const key = (boardId: Id): string => `wal:${boardId}`;

/**
 * The oldest document version this build can adopt from the log as it stands.
 *
 * The log outlives a release: the entry on disk was stamped by whichever build
 * wrote it, and the one reading it may be a deploy later. Every schema step so
 * far has been additive — a version 1 document already *is* a well-formed
 * version 2 one, which is why `api/src/domain/migrate.ts` walks 1 → 2 with the
 * identity — so an entry from the previous deploy is restamped and restored.
 * When a step stops being additive this number moves up with it, and entries
 * older than it are left alone rather than restored wrong.
 */
const OLDEST_READABLE_VERSION = 1;

/**
 * Bring a stored document up to the version this build speaks, or refuse it.
 *
 * The version is part of what is recovered, not a detail carried along with
 * it: the API accepts what it can migrate, so an entry restored at its old
 * version — or at one from a build newer than this bundle — is work that can
 * never be saved. Refusing leaves the entry on disk untouched for the build
 * that does understand it.
 */
function readableDoc(doc: BoardDoc): BoardDoc | null {
  const version: unknown = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;
  if (version < OLDEST_READABLE_VERSION || version > SCHEMA_VERSION) return null;
  return version === SCHEMA_VERSION ? doc : { ...doc, schemaVersion: SCHEMA_VERSION };
}

let warned = false;

function warn(action: string, err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`Karta: local write-ahead log unavailable (${action})`, err);
}

export async function writeWal(boardId: Id, doc: BoardDoc, etag: string | null): Promise<void> {
  const entry: WalEntry = { boardId, doc, savedAt: nowIso(), etag };
  try {
    await set(key(boardId), entry);
  } catch (err) {
    warn('write', err);
  }
}

export async function readWal(boardId: Id): Promise<WalEntry | null> {
  try {
    const entry = await get<WalEntry>(key(boardId));
    if (!entry || typeof entry !== 'object') return null;
    if (!entry.doc || entry.doc.id !== boardId) return null;
    const doc = readableDoc(entry.doc);
    if (!doc) return null;
    // An entry written before the ETag was recorded reads as "base unknown".
    return { ...entry, doc, etag: typeof entry.etag === 'string' ? entry.etag : null };
  } catch (err) {
    warn('read', err);
    return null;
  }
}

export async function clearWal(boardId: Id): Promise<void> {
  try {
    await del(key(boardId));
  } catch (err) {
    warn('clear', err);
  }
}

/* ------------------------------------------------------------------ *
 * Recoverability (spec 7.5.2, 7.5.3)
 * ------------------------------------------------------------------ */

/**
 * Fields that say nothing about whether an edit reached the server. The `PUT`
 * handler restamps `updatedAt` and takes `id`, `createdAt` and `acl` from the
 * stored document, and the camera is written on its own last-one-wins path
 * (spec 6.1) rather than through the write-ahead log. `schemaVersion` belongs
 * here for the same reason: it is stamped by whichever build wrote the entry,
 * so a release on its own would otherwise make every leftover entry look like
 * unsaved work and greet the user with a recovery prompt for nothing.
 */
const NOT_WORK: ReadonlySet<string> = new Set([
  'updatedAt',
  'createdAt',
  'id',
  'acl',
  'viewport',
  'schemaVersion',
]);

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const k of keys) {
    if (!deepEqual(left[k], right[k])) return false;
  }
  return true;
}

/** Do these two documents carry the same user work, ignoring what the server owns? */
function sameWork(a: BoardDoc, b: BoardDoc): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)].filter((k) => !NOT_WORK.has(k)));
  for (const k of keys) {
    if (!deepEqual(left[k], right[k])) return false;
  }
  return true;
}

/**
 * Does this entry still hold work the server does not have?
 *
 * Never decided on a timestamp: `doc.updatedAt` is stamped from the browser
 * clock on every mutation and from the server clock on every `PUT`, so the two
 * are not comparable and a machine running a minute slow would answer "no" for
 * every crash it ever has. An entry is dropped only when its work is provably
 * already on the server (spec 7.5.3).
 */
export function walHoldsUnsavedWork(entry: WalEntry, server: { doc: BoardDoc; etag: string | null }): boolean {
  // Same base: the entry was written on top of the very version we just loaded,
  // so no `PUT` of it can have succeeded — a 200 would have moved the ETag on
  // and cleared the entry. It is unsaved by construction.
  if (entry.etag !== null && server.etag !== null && entry.etag === server.etag) return true;

  // The base moved, which on its own says nothing: the entry may hold work that
  // never reached the server, or it may be one whose clear did not land after
  // its own save. The work itself is the only sound test.
  return !sameWork(entry.doc, server.doc);
}
