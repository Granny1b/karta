/**
 * The read half of the media flow (spec 6.3).
 *
 * `GET /api/media/read-token` mints one container-scoped read SAS with a
 * 60-minute TTL. It is held in module state — one token for the whole tab, not
 * one per image — and refreshed at the 50-minute mark. Blob names are immutable,
 * so between refreshes the browser serves every repeat view from its own cache
 * and the account sees no traffic at all.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Iso } from '@/domain/board';
import { api } from '@/lib/api';

/**
 * What the API returns. `baseUrl` is the blob endpoint the paths hang off
 * (`https://{account}.blob.core.windows.net`); when it is absent it is derived
 * from `sas`, which the API may send as a full URL with the signature attached.
 */
export interface ReadTokenResponse {
  sas: string;
  expiresAt: Iso;
  baseUrl?: string;
}

interface ReadToken {
  /** Blob endpoint without a trailing slash. Empty means "same origin". */
  baseUrl: string;
  /** The signature, without a leading `?`. */
  query: string;
  /** When to fetch the next one. */
  refreshAt: number;
}

const REFRESH_MS = 50 * 60_000; // spec 6.3
const EARLY_MS = 5 * 60_000; // never ride an expiry closer than this
const MIN_LIFETIME_MS = 30_000;
const RETRY_MS = 15_000;
const ABSOLUTE = /^https?:\/\//i;

let token: ReadToken | null = null;
let inflight: Promise<void> | null = null;
let nextAttemptAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ReadToken | null {
  return token;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function parseToken(res: ReadTokenResponse): ReadToken | null {
  const raw = typeof res.sas === 'string' ? res.sas.trim() : '';
  if (raw.length === 0) return null;

  let baseUrl = typeof res.baseUrl === 'string' ? res.baseUrl.trim() : '';
  let query = raw;

  if (ABSOLUTE.test(raw)) {
    // The API answered with `{blobEndpoint}?{signature}`.
    const mark = raw.indexOf('?');
    query = mark >= 0 ? raw.slice(mark + 1) : '';
    if (baseUrl.length === 0) baseUrl = mark >= 0 ? raw.slice(0, mark) : raw;
  }

  query = query.replace(/^\?+/, '');
  if (query.length === 0) return null;

  const now = Date.now();
  const expiresAt = Date.parse(res.expiresAt ?? '');
  let refreshAt = now + REFRESH_MS;
  if (Number.isFinite(expiresAt)) {
    refreshAt = Math.min(refreshAt, expiresAt - EARLY_MS);
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    query,
    refreshAt: Math.max(now + MIN_LIFETIME_MS, refreshAt),
  };
}

function scheduleRefresh(at: number): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    ensureToken();
  }, Math.max(1_000, at - Date.now()));
}

/** Fetch a token if there is none, or if the one held is due for renewal. */
function ensureToken(): void {
  if (inflight) return;
  const now = Date.now();
  if (token !== null && now < token.refreshAt) return;
  if (now < nextAttemptAt) return;

  inflight = (async () => {
    try {
      const parsed = parseToken(await api.mediaReadToken());
      if (parsed) {
        token = parsed;
        nextAttemptAt = 0;
        scheduleRefresh(parsed.refreshAt);
        emit();
      } else {
        nextAttemptAt = Date.now() + RETRY_MS;
      }
    } catch {
      // Images stay blank until the next attempt; there is nothing the person
      // looking at the board can do about it, so it does not raise a toast.
      nextAttemptAt = Date.now() + RETRY_MS;
    } finally {
      inflight = null;
    }
  })();
}

function buildUrl(current: ReadToken | null, path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (trimmed.length === 0) return null;
  if (ABSOLUTE.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
  if (current === null) return null;

  const clean = trimmed.replace(/^\/+/, '');
  if (clean.length === 0) return null;
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${current.baseUrl}/${encoded}?${current.query}`;
}

/**
 * Returns a resolver from a `MediaRef` path to a readable absolute URL, or
 * `null` while the read token is still on its way. The resolver's identity
 * changes when the token is renewed, so components re-render with fresh URLs.
 */
export function useMediaUrl(): (path: string | null | undefined) => string | null {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    ensureToken();
  }, [current]);

  return useCallback((path: string | null | undefined) => buildUrl(current, path), [current]);
}
