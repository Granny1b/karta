import { useMemo, useSyncExternalStore } from 'react';
import type { Id } from '@/domain/board';

/**
 * The whole router. One shape of URL — `#/b/{boardId}` — and nothing else, so a
 * board is linkable and the browser's back button walks the boards you visited.
 *
 * Navigation goes through the history API, which fires `popstate` on back and
 * forward but nothing at all on a programmatic push, so each call also announces
 * itself on a private event. All three are subscribed to.
 */

const PREFIX = '#/b/';
const ROUTE_EVENT = 'karta:route';

export interface Route {
  boardId: Id | null;
}

function parse(hash: string): Route {
  if (!hash.startsWith(PREFIX)) return { boardId: null };
  const raw = hash.slice(PREFIX.length).split(/[/?]/, 1)[0] ?? '';
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* a malformed escape means the hash was hand-edited; use it verbatim */
  }
  return { boardId: id.length > 0 ? id : null };
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

/** The route right now, for code that is not a component. */
export function currentRoute(): Route {
  return parse(currentHash());
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  window.addEventListener(ROUTE_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ROUTE_EVENT, onChange);
  };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash, () => '');
  return useMemo(() => parse(hash), [hash]);
}

function go(hash: string, replace: boolean): void {
  if (typeof window === 'undefined') return;
  if (window.location.hash === hash) return;

  const { pathname, search } = window.location;
  const url = `${pathname}${search}${hash}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/**
 * Open a board. `replace` is for navigations the user did not ask for — landing
 * on a default board at boot should not leave an empty entry in the history.
 */
export function navigateToBoard(boardId: Id, options: { replace?: boolean } = {}): void {
  go(`${PREFIX}${encodeURIComponent(boardId)}`, options.replace === true);
}

export function navigateHome(options: { replace?: boolean } = {}): void {
  go('', options.replace === true);
}
