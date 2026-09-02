import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { BoardSummary, Id } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { navigateToBoard } from '@/routes';

/**
 * The chain of parents, root first, ending at the open board (spec 7.3).
 *
 * The walk is only as good as the index it walks. A board the index has not
 * caught up with — one just created, or created in another tab — used to break
 * the loop on its very first step and leave *no* breadcrumb at all, which reads
 * as the feature being broken rather than as one missing ancestor.
 *
 * `fallbackTitle` is the open board's own title, which the document always
 * knows even when the index does not. With it the breadcrumb degrades to the
 * board you are on instead of vanishing, and fills itself in as soon as the
 * index arrives.
 */
export function chainFor(
  boardId: Id | null,
  boards: BoardSummary[] | undefined,
  fallbackTitle?: string,
): BoardSummary[] {
  if (!boardId) return [];
  if (!boards) return standIn(boardId, fallbackTitle);
  const byId = new Map<Id, BoardSummary>(boards.map((b) => [b.id, b]));
  if (!byId.has(boardId)) return standIn(boardId, fallbackTitle);

  const chain: BoardSummary[] = [];
  const seen = new Set<Id>();
  let cursor: Id | null = boardId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const summary: BoardSummary | undefined = byId.get(cursor);
    if (!summary) break;
    chain.push(summary);
    cursor = summary.parentBoardId;
  }
  return chain.reverse();
}

/** The open board alone, for when the index cannot place it yet. */
function standIn(boardId: Id, title: string | undefined): BoardSummary[] {
  if (title === undefined) return [];
  return [
    {
      id: boardId,
      parentBoardId: null,
      title,
      icon: null,
      updatedAt: '',
      deletedAt: null,
      counts: { cards: 0, done: 0, children: 0 },
      ownerId: '',
    },
  ];
}

export default function Breadcrumb(): JSX.Element {
  const boardId = useBoardStore((s) => s.boardId);
  const index = useBoardStore((s) => s.index);
  const title = useBoardStore((s) => s.doc?.title ?? '');
  const mutate = useBoardStore((s) => s.mutate);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const chain = useMemo(() => chainFor(boardId, index?.boards, title), [boardId, index, title]);
  const ancestors = chain.slice(0, -1);

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  const commit = (): void => {
    const next = draft.trim();
    setRenaming(false);
    if (next.length === 0 || next === title) return;
    mutate('Rename board', (d) => {
      d.title = next;
    });
  };

  // Deep trees collapse in the middle; the sidebar is the place to see them all.
  const shown = ancestors.length > 2 ? ancestors.slice(-2) : ancestors;
  const collapsed = ancestors.length - shown.length;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-caption">
      {collapsed > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            title={`${collapsed} more board${collapsed === 1 ? '' : 's'} above`}
            className="h-7 rounded px-1 text-ink-muted transition-colors duration-fast ease-linear hover:bg-hover hover:text-ink"
          >
            …
          </button>
          <ChevronRight size={13} className="shrink-0 text-line-strong" aria-hidden />
        </>
      ) : null}

      {shown.map((summary) => (
        <span key={summary.id} className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => navigateToBoard(summary.id)}
            className="h-7 max-w-[16ch] truncate rounded px-1 text-ink-muted transition-colors duration-fast ease-linear hover:bg-hover hover:text-ink"
          >
            {summary.title}
          </button>
          <ChevronRight size={13} className="shrink-0 text-line-strong" aria-hidden />
        </span>
      ))}

      {renaming ? (
        <input
          ref={input}
          value={draft}
          aria-label="Board title"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setRenaming(false);
            }
          }}
          className="karta-field karta-field--sm w-[22ch] font-condensed text-body font-semibold"
        />
      ) : (
        <button
          type="button"
          title="Double-click to rename"
          onDoubleClick={() => {
            if (!boardId) return;
            setDraft(title);
            setRenaming(true);
          }}
          className="h-7 max-w-[28ch] truncate rounded px-1 font-condensed text-body font-semibold text-ink transition-colors duration-fast ease-linear hover:bg-hover"
        >
          {title || 'Untitled board'}
        </button>
      )}
    </nav>
  );
}
