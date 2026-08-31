import type { Iso } from '@/domain/board';

/** Current instant as an ISO 8601 UTC string — the only timestamp source. */
export function nowIso(): Iso {
  return new Date().toISOString();
}

const DAY_MS = 86_400_000;

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function parse(iso: Iso | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole calendar days from `from` to `to`, ignoring the time of day. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

/** "12 Mar" for this year, "12 Mar 2024" otherwise. */
export function formatDate(iso: Iso | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '';
  return d.getFullYear() === now.getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d);
}

/** "12 Mar 2026, 14:05" — used for snapshots and the debug panel. */
export function formatDateTime(iso: Iso | null | undefined): string {
  const d = parse(iso);
  return d ? dateTime.format(d) : '';
}

/** "just now", "6 min ago", "3 h ago", "yesterday", "4 days ago", then a date. */
export function formatRelative(iso: Iso | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '';

  const diff = now.getTime() - d.getTime();
  if (diff < 0) return 'just now';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = -calendarDaysBetween(now, d);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(iso, now);
}

/** 812 B, 231 KB, 1.4 MB. Decimal units — the numbers are quoted at users, not at disks. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const kb = bytes / 1000;
  if (kb < 1000) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export type DueTone = 'none' | 'overdue' | 'today' | 'soon' | 'later';

/**
 * Due-date chip text and tone. Display only — there are no notifications
 * anywhere in this product.
 */
export function formatDue(iso: Iso | null | undefined, now: Date = new Date()): { text: string; tone: DueTone } {
  const d = parse(iso);
  if (!d) return { text: '', tone: 'none' };

  const days = calendarDaysBetween(now, d);
  if (days < 0) {
    const late = -days;
    return { text: late === 1 ? 'Yesterday' : `${late} days ago`, tone: 'overdue' };
  }
  if (days === 0) return { text: 'Today', tone: 'today' };
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
  if (days < 7) return { text: weekday.format(d), tone: days <= 2 ? 'soon' : 'later' };
  return { text: formatDate(iso, now), tone: 'later' };
}

export function isOverdue(iso: Iso | null | undefined, now: Date = new Date()): boolean {
  const d = parse(iso);
  return d !== null && calendarDaysBetween(now, d) < 0;
}
