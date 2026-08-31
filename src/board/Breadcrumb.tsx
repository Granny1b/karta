import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { BoardSummary, Id } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { navigateToBoard } from '@/routes';

/** The chain of parents, root first, ending at the open board (spec 7.3). */
function chainFor(boardId: Id | null, boards: BoardSummary[] | undefined): BoardSummary[] {
  if (!boardId || !boards) return [];
  const byId = new Map<Id, BoardSummary>(boards.map((b) => [b.id, b]));

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

export default function Breadcrumb(): JSX.Element {
  const boardId = useBoardStore((s) => s.boardId);
  const index = useBoardStore((s) => s.index);
  const title = useBoardStore((s) => s.doc?.title ?? '');
  const mutate = useBoardStore((s) => s.mutate);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const chain = useMemo(() => chainFor(boardId, index?.boards), [boardId, index]);
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
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
      {collapsed > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            title={`${collapsed} more board${collapsed === 1 ? '' : 's'} above`}
            className="rounded px-1 text-ink-muted hover:text-ink"
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
            className="max-w-[16ch] truncate rounded px-1 text-ink-muted hover:text-ink"
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
          className="w-[22ch] rounded border border-line bg-raised px-1 py-0.5 font-condensed text-[15px] font-semibold text-ink outline-none focus:border-[var(--focus)]"
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
          className="max-w-[28ch] truncate rounded px-1 font-condensed text-[15px] font-semibold text-ink"
        >
          {title || 'Untitled board'}
        </button>
      )}
    </nav>
  );
}
