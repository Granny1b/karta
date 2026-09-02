import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FolderPlus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { cx } from '@/canvas/cx';
import { DEFAULT_NODE_SIZE, type BoardNode, type BoardSummary, type Id } from '@/domain/board';
import { ApiError, api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { renameBoard } from '@/board/renameBoard';
import { makeBoardLink } from '@/state/factories';
import { boardTree, type TreeNode } from '@/state/selectors';
import { navigateToBoard } from '@/routes';
import { createStarterProject } from '@/board/template';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';

/* ------------------------------------------------------------------ *
 * Where a new child board's doorway goes
 * ------------------------------------------------------------------ */

/** The canvas's own grid (spec 7.3), so a placed node lines up with dragged ones. */
const GRID = 8;
/** Breathing room between the link and its neighbours — the frame padding. */
const GAP = 24;
/** Where the first node on an empty board goes: the margin an extract uses. */
const ORIGIN = 80;
/** A bound on the search, so a board the size of a city is still cheap to place on. */
const SCAN = 24;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** Touching is not overlapping: two boxes edge to edge leave the gap between them. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * A spot on `nodes`' own grid where a board link fits without covering anything
 * (spec 5.2: the parent reads as a dashboard, which it cannot do if the doorway
 * lands on top of a card).
 *
 * The walk starts at the top-left of what is already there and reads left to
 * right, one slot wider and one row taller than the content — so a gap in the
 * arrangement is filled before the board grows, a full row is continued at its
 * end, and a board of five links in a row gets a sixth beside them rather than
 * a node somewhere off-screen. Bounded, and below everything if the bound is
 * reached, which is always free.
 */
export function freeSpotForLink(
  nodes: readonly BoardNode[],
  size: { w: number; h: number } = DEFAULT_NODE_SIZE.boardLink,
): { x: number; y: number } {
  const boxes: Box[] = nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    w: node.size.w,
    h: node.size.h,
  }));
  if (boxes.length === 0) return { x: ORIGIN, y: ORIGIN };

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }

  const step = { x: size.w + GAP, y: size.h + GAP };
  const start = { x: snap(left), y: snap(top) };
  const cols = Math.min(SCAN, Math.ceil((right - left) / step.x) + 1);
  const rows = Math.min(SCAN, Math.ceil((bottom - top) / step.y) + 1);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const at = { x: start.x + col * step.x, y: start.y + row * step.y };
      const wanted: Box = { x: at.x - GAP, y: at.y - GAP, w: size.w + GAP * 2, h: size.h + GAP * 2 };
      if (!boxes.some((box) => overlaps(wanted, box))) return at;
    }
  }

  return { x: start.x, y: snap(bottom + GAP) };
}

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

  /**
   * The doorway the new child is reached by (spec 5.2). A board that exists only
   * in this tree is a board the canvas cannot see, and the parent stops reading
   * as a dashboard the moment one of its children is invisible on it.
   *
   * Two ways in, because the parent is not always the board on screen:
   *
   * - The open board takes an ordinary edit — one undo entry, flushed before we
   *   navigate away, so the link is on the server before the child opens.
   * - Any other board is read and written back under the ETag it was read at,
   *   which is the same guarded round trip a rename of a closed board already
   *   takes. It is a compare-and-swap, not a blind overwrite: if that board
   *   changed in the meantime the write is refused and *stays* refused — we do
   *   not re-read and force — and the toast says so. Either way the write is
   *   announced by name, so no board is edited behind the user's back.
   */
  const linkChildOnParent = useCallback(
    async (parentBoardId: Id, childId: Id, childTitle: string): Promise<void> => {
      const store = useBoardStore.getState();
      const link = makeBoardLink({
        targetBoardId: childId,
        cachedTitle: childTitle,
        // Empty, and true: the rollup is refreshed from the index on open.
        cachedCounts: { total: 0, done: 0 },
        userId,
      });

      if (store.boardId === parentBoardId && store.doc) {
        link.position = freeSpotForLink(store.doc.nodes);
        mutate('Add board link', (d) => {
          d.nodes.push(link);
        });
        await save();
        return;
      }

      const { doc, etag } = await api.getBoard(parentBoardId);
      link.position = freeSpotForLink(doc.nodes);
      await api.putBoard(parentBoardId, { ...doc, nodes: [...doc.nodes, link] }, etag, []);
    },
    [mutate, save, userId],
  );

  const createBoard = useCallback(
    async (parentBoardId: Id | null) => {
      if (busy) return;
      setBusy(true);
      try {
        const created = await api.createBoard({ title: 'New board', parentBoardId });

        if (parentBoardId !== null) {
          const parent = summaries.find((b) => b.id === parentBoardId);
          const on = `“${parent?.title ?? 'the parent board'}”`;
          try {
            await linkChildOnParent(parentBoardId, created.doc.id, created.doc.title);
            toast(`Added a link on ${on}.`);
          } catch (err) {
            // The child board is made and listed either way; only its doorway
            // is missing, and saying which board did not get it is the point.
            const clash = err instanceof ApiError && err.conflict;
            toast(
              clash
                ? `The board was created, but ${on} changed first — no link was added.`
                : `The board was created, but no link could be added on ${on}.`,
              'warn',
            );
          }
        }

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
    [busy, linkChildOnParent, loadIndex, report, summaries, toast],
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

      // Any other board is the guarded round trip in `renameBoard`, shared with
      // the board tile on the canvas so the compare-and-swap exists once.
      setBusy(true);
      try {
        await renameBoard(id, trimmed);
      } finally {
        setBusy(false);
      }
    },
    [boardId, loadIndex, mutate, save, summaries],
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
        className="absolute inset-0 z-20 bg-[var(--scrim-soft)]"
        onMouseDown={() => setSidebarOpen(false)}
        aria-hidden
      />
      <aside
        aria-label="Boards"
        className="karta-panel absolute bottom-0 left-0 top-0 z-30 w-sidebar max-w-[85vw] border-r border-line"
      >
        <header className="karta-panel-head">
          <h2 className="min-w-0 flex-1 truncate text-body">Boards</h2>
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
            <p className="px-4 py-4 text-caption text-ink-muted">No boards yet.</p>
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

        <footer className="karta-panel-foot px-3">
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
        className={cx('group flex items-center gap-1 pr-1', isCurrent ? 'bg-sunken' : 'hover:bg-hover')}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {children.length > 0 ? (
          <IconButton
            size="sm"
            label={isOpen ? `Collapse ${summary.title}` : `Expand ${summary.title}`}
            aria-expanded={isOpen}
            icon={isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            onClick={() => props.onToggle(summary.id)}
          />
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
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
            className={cx(
              'h-7 min-w-0 flex-1 truncate text-left text-caption',
              isCurrent ? 'text-ink' : 'text-ink-muted group-hover:text-ink',
            )}
          >
            {summary.icon ? <span className="mr-1">{summary.icon}</span> : null}
            {summary.title}
          </button>
        )}

        <span className="shrink-0 font-mono text-meta text-ink-muted" title={`${done} of ${cards} cards done`}>
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
          className="flex flex-wrap items-center gap-2 border-y border-line bg-sunken py-2 pr-2 text-caption text-ink-muted"
          style={{ paddingLeft: `${depth * 14 + 36}px` }}
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
      className="karta-field karta-field--sm min-w-0 flex-1"
    />
  );
}
