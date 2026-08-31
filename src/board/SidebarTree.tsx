import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FolderPlus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { BoardSummary, Id } from '@/domain/board';
import { api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { boardTree, type TreeNode } from '@/state/selectors';
import { navigateToBoard } from '@/routes';
import { createStarterProject } from '@/board/template';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';

/**
 * The board tree (spec 8.3). It opens over the canvas and never resizes it, so
 * navigating between boards does not move a single node on screen.
 */
export default function SidebarTree(): JSX.Element | null {
  const open = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const toast = useUiStore((s) => s.toast);

  const index = useBoardStore((s) => s.index);
  const boardId = useBoardStore((s) => s.boardId);
  const userId = useBoardStore((s) => s.me?.userId ?? '');
  const loadIndex = useBoardStore((s) => s.loadIndex);
  const mutate = useBoardStore((s) => s.mutate);
  const save = useBoardStore((s) => s.save);

  const tree = useMemo(() => boardTree(index), [index]);
  const summaries = useMemo(() => index?.boards ?? [], [index]);

  const [expanded, setExpanded] = useState<Set<Id>>(new Set());
  const [renamingId, setRenamingId] = useState<Id | null>(null);
  const [confirmId, setConfirmId] = useState<Id | null>(null);
  const [busy, setBusy] = useState(false);

  // Whichever board is open, its ancestors are visible.
  useEffect(() => {
    if (!boardId) return;
    const byId = new Map<Id, BoardSummary>(summaries.map((b) => [b.id, b]));
    const chain: Id[] = [];
    const seen = new Set<Id>();
    let cursor: Id | null = byId.get(boardId)?.parentBoardId ?? null;
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = byId.get(cursor)?.parentBoardId ?? null;
    }
    if (chain.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const id of chain) next.add(id);
      return next;
    });
  }, [boardId, summaries]);

  const toggle = useCallback((id: Id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const report = useCallback(
    (err: unknown, fallback: string) => {
      toast(err instanceof Error && err.message ? err.message : fallback, 'error');
    },
    [toast],
  );

  const createBoard = useCallback(
    async (parentBoardId: Id | null) => {
      if (busy) return;
      setBusy(true);
      try {
        const created = await api.createBoard({ title: 'New board', parentBoardId });
        await loadIndex();
        if (parentBoardId) setExpanded((current) => new Set(current).add(parentBoardId));
        navigateToBoard(created.doc.id);
        setRenamingId(created.doc.id);
      } catch (err) {
        report(err, 'Could not create the board');
      } finally {
        setBusy(false);
      }
    },
    [busy, loadIndex, report],
  );

  const rename = useCallback(
    async (id: Id, title: string) => {
      setRenamingId(null);
      const trimmed = title.trim();
      const summary = summaries.find((b) => b.id === id);
      if (trimmed.length === 0 || !summary || trimmed === summary.title) return;

      // The open board renames through the store, so it undoes like any edit.
      if (id === boardId) {
        mutate('Rename board', (d) => {
          d.title = trimmed;
        });
        await save();
        await loadIndex();
        return;
      }

      setBusy(true);
      try {
        const { doc, etag } = await api.getBoard(id);
        await api.putBoard(id, { ...doc, title: trimmed }, etag, []);
        await loadIndex();
      } catch (err) {
        report(err, 'Could not rename the board');
      } finally {
        setBusy(false);
      }
    },
    [boardId, loadIndex, mutate, report, save, summaries],
  );

  const remove = useCallback(
    async (id: Id) => {
      setConfirmId(null);
      setBusy(true);
      try {
        await api.deleteBoard(id);
        await loadIndex();
        if (id === boardId) {
          const next = useBoardStore
            .getState()
            .index?.boards.find((b) => b.deletedAt === null && b.id !== id);
          if (next) navigateToBoard(next.id, { replace: true });
        }
        toast('Board deleted. It is recoverable from storage for 14 days.');
      } catch (err) {
        report(err, 'Could not delete the board');
      } finally {
        setBusy(false);
      }
    },
    [boardId, loadIndex, report, toast],
  );

  const fromTemplate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { rootId } = await createStarterProject({ userId });
      await loadIndex();
      navigateToBoard(rootId);
      toast('Created the MMORPG template.');
    } catch (err) {
      report(err, 'Could not create the template');
    } finally {
      setBusy(false);
    }
  }, [busy, loadIndex, report, toast, userId]);

  if (!open) return null;

  return (
    <>
      <div
        className="absolute inset-0 z-20 bg-black/10"
        onMouseDown={() => setSidebarOpen(false)}
        aria-hidden
      />
      <aside
        aria-label="Boards"
        className="absolute bottom-0 left-0 top-0 z-30 flex w-[var(--sidebar-w)] max-w-[85vw] flex-col border-r border-line bg-raised text-ink"
      >
        <header className="flex items-center gap-1 border-b border-line px-2 py-2">
          <h2 className="min-w-0 flex-1 truncate px-1 font-condensed text-[15px] font-semibold">Boards</h2>
          <IconButton
            label="New board"
            size="sm"
            icon={<Plus size={16} />}
            disabled={busy}
            onClick={() => void createBoard(null)}
          />
          <IconButton
            label="Close the board list"
            size="sm"
            icon={<X size={16} />}
            onClick={() => setSidebarOpen(false)}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {tree.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-ink-muted">No boards yet.</p>
          ) : (
            tree.map((node) => (
              <Row
                key={node.summary.id}
                node={node}
                depth={0}
                currentId={boardId}
                expanded={expanded}
                busy={busy}
                renamingId={renamingId}
                confirmId={confirmId}
                onToggle={toggle}
                onOpen={(id) => navigateToBoard(id)}
                onStartRename={setRenamingId}
                onRename={(id, title) => void rename(id, title)}
                onAddChild={(id) => void createBoard(id)}
                onAskDelete={setConfirmId}
                onDelete={(id) => void remove(id)}
              />
            ))
          )}
        </div>

        <footer className="border-t border-line p-2">
          <Button
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => void fromTemplate()}
            title="Creates the MMORPG board and its five child boards"
          >
            <Sparkles size={14} />
            New board from template
          </Button>
        </footer>
      </aside>
    </>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  currentId: Id | null;
  expanded: Set<Id>;
  busy: boolean;
  renamingId: Id | null;
  confirmId: Id | null;
  onToggle(id: Id): void;
  onOpen(id: Id): void;
  onStartRename(id: Id | null): void;
  onRename(id: Id, title: string): void;
  onAddChild(id: Id): void;
  onAskDelete(id: Id | null): void;
  onDelete(id: Id): void;
}

function Row(props: RowProps): JSX.Element {
  const { node, depth, currentId, expanded, renamingId, confirmId, busy } = props;
  const { summary, children } = node;
  const isOpen = expanded.has(summary.id);
  const isCurrent = summary.id === currentId;
  const { done, cards } = summary.counts;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 pr-1 ${isCurrent ? 'bg-sunken' : 'hover:bg-sunken'}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={isOpen ? `Collapse ${summary.title}` : `Expand ${summary.title}`}
            aria-expanded={isOpen}
            onClick={() => props.onToggle(summary.id)}
            className="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink"
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[22px] shrink-0" aria-hidden />
        )}

        {renamingId === summary.id ? (
          <RenameField
            initial={summary.title}
            onCommit={(value) => props.onRename(summary.id, value)}
            onCancel={() => props.onStartRename(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => props.onOpen(summary.id)}
            onDoubleClick={() => props.onStartRename(summary.id)}
            title={`${summary.title} — double-click to rename`}
            className={`min-w-0 flex-1 truncate py-1 text-left text-[13px] ${isCurrent ? 'text-ink' : 'text-ink-muted group-hover:text-ink'}`}
          >
            {summary.icon ? <span className="mr-1">{summary.icon}</span> : null}
            {summary.title}
          </button>
        )}

        <span className="shrink-0 font-mono text-[11px] text-ink-muted" title={`${done} of ${cards} cards done`}>
          {cards > 0 ? `${done}/${cards}` : ''}
        </span>

        <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
          <IconButton
            label={`New board inside ${summary.title}`}
            size="sm"
            disabled={busy}
            icon={<FolderPlus size={14} />}
            onClick={() => props.onAddChild(summary.id)}
          />
          <IconButton
            label={`Delete ${summary.title}`}
            size="sm"
            disabled={busy}
            icon={<Trash2 size={14} />}
            onClick={() => props.onAskDelete(summary.id)}
          />
        </span>
      </div>

      {confirmId === summary.id ? (
        <div
          className="flex flex-wrap items-center gap-2 border-y border-line bg-sunken py-2 pr-2 text-[13px] text-ink-muted"
          style={{ paddingLeft: `${depth * 14 + 26}px` }}
        >
          <span>
            Delete “{summary.title}”?
            {children.length > 0 ? ` Its ${children.length} nested board${children.length === 1 ? '' : 's'} move to the top level.` : ''}
          </span>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => props.onDelete(summary.id)}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => props.onAskDelete(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {isOpen
        ? children.map((child) => <Row key={child.summary.id} {...props} node={child} depth={depth + 1} />)
        : null}
    </div>
  );
}

function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(value: string): void;
  onCancel(): void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      aria-label="Board name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="my-0.5 min-w-0 flex-1 rounded border border-line bg-raised px-1 py-0.5 text-[13px] text-ink outline-none focus:border-[var(--focus)]"
    />
  );
}
