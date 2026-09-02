import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { LayoutGrid, Square } from 'lucide-react';
import type { Id } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { SHAPE_LABEL } from '@/canvas/shapes';
import { cardNodes } from '@/state/selectors';
import { navigateToBoard } from '@/routes';
import Dialog from '@/components/Dialog';

/**
 * `Ctrl+K` (spec 10, phase 7). Index-first: every board title is searched, plus
 * the cards of the board that is open — the only board whose bodies are in
 * memory. Searching every board's body is a deliberate non-goal (spec 12).
 */

const LIMIT = 24;

interface Hit {
  key: string;
  kind: 'board' | 'card';
  id: Id;
  title: string;
  detail: string;
  score: number;
}

function score(haystack: string, needle: string, weight: number): number {
  const text = haystack.toLowerCase();
  const at = text.indexOf(needle);
  if (at < 0) return 0;
  if (at === 0) return weight + 2;
  return text[at - 1] === ' ' ? weight + 1 : weight;
}

function snippet(body: string, needle: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '';
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return flat.slice(0, 90);
  const from = Math.max(0, at - 30);
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + 90)}`;
}

export default function SearchDialog(): JSX.Element {
  const index = useBoardStore((s) => s.index);
  const doc = useBoardStore((s) => s.doc);
  const boardId = useBoardStore((s) => s.boardId);
  const setDialog = useUiStore((s) => s.setDialog);
  const openEditor = useUiStore((s) => s.openEditor);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const boards = useMemo(() => (index?.boards ?? []).filter((b) => b.deletedAt === null), [index]);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();

    if (needle.length === 0) {
      // No query yet: the boards touched most recently, which is what a person
      // reaching for Ctrl+K usually wants anyway.
      return [...boards]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 8)
        .map((summary) => ({
          key: `board:${summary.id}`,
          kind: 'board' as const,
          id: summary.id,
          title: summary.title,
          detail: `${summary.counts.done}/${summary.counts.cards} done`,
          score: 0,
        }));
    }

    const found: Hit[] = [];

    for (const summary of boards) {
      const value = score(summary.title, needle, 30);
      if (value > 0) {
        found.push({
          key: `board:${summary.id}`,
          kind: 'board',
          id: summary.id,
          title: summary.title,
          detail: `Board · ${summary.counts.done}/${summary.counts.cards} done`,
          score: value,
        });
      }
    }

    const boardTitle = doc?.title ?? 'This board';
    for (const card of cardNodes(doc)) {
      const inTitle = score(card.title, needle, 20);
      const inBody = inTitle > 0 ? 0 : score(card.body, needle, 8);
      if (inTitle === 0 && inBody === 0) continue;
      found.push({
        key: `card:${card.id}`,
        kind: 'card',
        id: card.id,
        title: card.title || 'Untitled card',
        detail: inBody > 0 ? snippet(card.body, needle) : boardTitle,
        score: Math.max(inTitle, inBody),
      });
    }

    // Everything else on the board that carries words. Cards came first and
    // still outrank the rest, but a sticky, a heading or a labelled shape is a
    // thing the user put there and expects to be able to find again.
    for (const node of doc?.nodes ?? []) {
      let text: string | null = null;
      let kindLabel = '';
      if (node.kind === 'note') {
        text = node.text;
        kindLabel = 'Note';
      } else if (node.kind === 'text') {
        text = node.text;
        kindLabel = 'Text';
      } else if (node.kind === 'shape') {
        text = node.label;
        kindLabel = SHAPE_LABEL[node.shape];
      }
      if (text === null) continue;

      const value = score(text, needle, 12);
      if (value === 0) continue;
      found.push({
        key: `node:${node.id}`,
        kind: 'card',
        id: node.id,
        title: text.trim().split('\n')[0]?.slice(0, 80) || kindLabel,
        detail: `${kindLabel} on ${boardTitle}`,
        score: value,
      });
    }

    return found.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, LIMIT);
  }, [boards, doc, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, hits]);

  const activate = (hit: Hit | undefined): void => {
    if (!hit) return;
    setDialog(null);
    if (hit.kind === 'board') {
      if (hit.id !== boardId) navigateToBoard(hit.id);
      return;
    }
    openEditor(hit.id);
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (hits.length === 0 ? 0 : (c + 1) % hits.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (hits.length === 0 ? 0 : (c - 1 + hits.length) % hits.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(hits[cursor]);
    }
  };

  return (
    <Dialog title="Search" width="md" initialFocus={input} onClose={() => setDialog(null)}>
      <div onKeyDown={onKeyDown}>
        <input
          ref={input}
          value={query}
          placeholder="Board titles, and anything on this board"
          aria-label="Search boards and cards"
          onChange={(e) => setQuery(e.target.value)}
          className="karta-field text-body"
        />

        {hits.length === 0 ? (
          <p className="py-6 text-center text-ui text-ink-muted">Nothing matches.</p>
        ) : (
          <ul ref={listRef} className="mt-2 flex max-h-[46vh] flex-col overflow-y-auto">
            {hits.map((hit, i) => (
              <li key={hit.key}>
                <button
                  type="button"
                  data-active={i === cursor}
                  tabIndex={-1}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => activate(hit)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                    i === cursor ? 'bg-sunken' : ''
                  }`}
                >
                  <span className="shrink-0 text-ink-muted" aria-hidden>
                    {hit.kind === 'board' ? <LayoutGrid size={14} /> : <Square size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-ink">{hit.title}</span>
                    <span className="block truncate text-control text-ink-muted">{hit.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-control text-ink-muted">
          <kbd className="karta-kbd">↑</kbd> <kbd className="karta-kbd">↓</kbd> to move,{' '}
          <kbd className="karta-kbd">Enter</kbd> to open. Card bodies are searched on the open board only.
        </p>
      </div>
    </Dialog>
  );
}
