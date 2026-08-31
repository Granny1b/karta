import { generateKeyBetween } from 'fractional-indexing';

/**
 * Fractional index helpers (spec 7.1). Ranks order cards inside a kanban column
 * and checklist items inside a card, without renumbering siblings on a move.
 *
 * Every entry point is defensive: ranks arrive from imported JSON and from other
 * clients, so equal, reversed or malformed bounds must never throw.
 */

const FIRST_KEY = 'a0'; // generateKeyBetween(null, null)

function clean(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A rank strictly between `a` and `b`. Bounds may be given in either order; if
 * they are equal the result sits just after them. Invalid key material degrades
 * to appending rather than throwing.
 */
export function rankBetween(a: string | null, b: string | null): string {
  let lower = clean(a);
  let upper = clean(b);

  if (lower !== null && upper !== null) {
    if (lower === upper) upper = null;
    else if (lower > upper) [lower, upper] = [upper, lower];
  }

  try {
    return generateKeyBetween(lower, upper);
  } catch {
    // One of the bounds is not a valid key — ignore the upper bound, then both.
    try {
      return generateKeyBetween(lower, null);
    } catch {
      return FIRST_KEY;
    }
  }
}

/** A rank that sorts after every rank in `existing`. */
export function rankAfterAll(existing: string[]): string {
  let max: string | null = null;
  for (const value of existing) {
    const key = clean(value);
    if (key !== null && (max === null || key > max)) max = key;
  }
  return rankBetween(max, null);
}

/** A rank that sorts before every rank in `existing`. */
export function rankBeforeAll(existing: string[]): string {
  let min: string | null = null;
  for (const value of existing) {
    const key = clean(value);
    if (key !== null && (min === null || key < min)) min = key;
  }
  return rankBetween(null, min);
}

/** `Array.prototype.sort` comparator for anything carrying a `rank`. */
export function byRank<T extends { rank: string }>(a: T, b: T): number {
  return compare(a.rank, b.rank);
}
