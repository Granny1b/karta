import { del, get, set } from 'idb-keyval';
import type { BoardDoc, Id, Iso } from '@/domain/board';
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
    // An entry written before the ETag was recorded reads as "base unknown".
    return { ...entry, etag: typeof entry.etag === 'string' ? entry.etag : null };
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
 * (spec 6.1) rather than through the write-ahead log.
 */
const NOT_WORK: ReadonlySet<string> = new Set(['updatedAt', 'createdAt', 'id', 'acl', 'viewport']);

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
