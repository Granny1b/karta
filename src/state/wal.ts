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
}

const key = (boardId: Id): string => `wal:${boardId}`;

let warned = false;

function warn(action: string, err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`Karta: local write-ahead log unavailable (${action})`, err);
}

export async function writeWal(boardId: Id, doc: BoardDoc): Promise<void> {
  const entry: WalEntry = { boardId, doc, savedAt: nowIso() };
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
    return entry;
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
