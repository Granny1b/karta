import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react';
import type { NodeProps } from '@xyflow/react';
import { Pencil, SquareArrowOutUpRight } from 'lucide-react';
import { NodeToolbar, Position } from '@xyflow/react';
import { MAX_TITLE, capText } from '@/domain/board';
import { renameBoard } from '@/board/renameBoard';
import { takeRenameOnMount } from '@/canvas/createSubBoard';
import { useSoleNodeSelected } from '@/canvas/soleSelection';
import { isEditableTarget } from '@/lib/keys';
import { colorValue } from '@/lib/colors';
import { cx } from '@/canvas/cx';
import { useCanvasApi } from '@/canvas/CanvasContext';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import { useLod } from '@/canvas/nodes/hooks';
import type { BoardLinkFlowNode } from '@/canvas/types';

/** The doorway to a nested board, with the rollup the index keeps fresh (spec 5.2). */
function BoardLinkNodeView({ data, selected, dragging }: NodeProps<BoardLinkFlowNode>): JSX.Element {
  const link = data.node;
  const lod = useLod();
  const { navigateToBoard } = useCanvasApi();
  const sole = useSoleNodeSelected();
  const accent = colorValue(link.color);
  const counts = link.cachedCounts;

  // Renaming here renames the board, not the tile: `cachedTitle` is a copy the
  // index refreshes, so writing only to it would be undone on the next poll.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const input = useRef<HTMLInputElement>(null);
  const title = link.cachedTitle.trim().length > 0 ? link.cachedTitle : 'Board';

  const beginRename = useCallback((): void => {
    if (link.locked) return;
    setDraft(link.cachedTitle);
  }, [link.cachedTitle, link.locked]);

  const commitRename = useCallback(
    (value: string): void => {
      setDraft(null);
      const next = capText(value.trim(), MAX_TITLE);
      if (next.length === 0 || next === link.cachedTitle) return;
      void renameBoard(link.targetBoardId, next);
    },
    [link.cachedTitle, link.targetBoardId],
  );

  // A tile that was just created opens its name field straight away.
  useEffect(() => {
    if (link.locked) return;
    if (takeRenameOnMount(link.id)) setDraft(link.cachedTitle);
    // Deliberately once per mount: the signal is consumed on read, and this
    // must not fire again when the title changes underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  /*
   * Double-click already means "go in", which is the gesture this node exists
   * for, so renaming gets F2 — and Enter, which does nothing else on a tile
   * that has no editor panel to open.
   */
  useEffect(() => {
    if (selected !== true || !sole || editing || link.locked) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key !== 'F2' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      beginRename();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [beginRename, editing, link.locked, selected, sole]);

  const onRenameKey = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        commitRename(event.currentTarget.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDraft(null);
      }
    },
    [commitRename],
  );

  const open = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      navigateToBoard(link.targetBoardId);
    },
    [navigateToBoard, link.targetBoardId],
  );

  const root = cx(
    'karta-node karta-boardlink',
    `karta-lod-${lod}`,
    selected && 'is-selected',
    dragging && 'is-dragging',
  );

  if (lod === 'block') {
    return (
      <div className={cx(root, 'karta-block')} style={{ background: accent }} onDoubleClick={open} title={title}>
        <NodeHandles connectable={!link.locked} />
      </div>
    );
  }

  return (
    <>
      {/* Renaming is not double-click here — that opens the board — so it needs
          somewhere to be seen. Only for the tile a keystroke would land on. */}
      {selected === true && sole && !link.locked && !editing && (
        <NodeToolbar position={Position.Bottom} offset={10} className="karta-node-toolbar">
          <div className="karta-toolbar-row">
            <button
              type="button"
              className="karta-tool-btn karta-tool-icon"
              title="Rename this board (F2)"
              aria-label="Rename this board"
              onClick={beginRename}
            >
              <Pencil size={13} />
            </button>
          </div>
        </NodeToolbar>
      )}

    <div
      className={root}
      onDoubleClick={editing ? undefined : open}
      title={editing ? undefined : `${title} — double-click to open, F2 to rename`}
    >
      <span className="karta-colorbar" style={{ background: accent }} aria-hidden />
      <div className="flex h-full flex-col justify-center gap-1.5 overflow-hidden py-2 pl-4 pr-2.5">
        <div className="flex items-center gap-1.5">
          <SquareArrowOutUpRight size={14} className="shrink-0 text-ink-muted" aria-hidden />
          {editing ? (
            <input
              ref={input}
              className="karta-card-title nodrag nowheel min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none"
              value={draft}
              maxLength={MAX_TITLE}
              aria-label="Board name"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={(event) => commitRename(event.currentTarget.value)}
              onKeyDown={onRenameKey}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="karta-card-title truncate">{title}</div>
          )}
        </div>
        {lod !== 'title' && (
          <div className="text-[12px] text-ink-muted">
            {counts && counts.total > 0
              ? `${counts.done} of ${counts.total} done`
              : counts
                ? 'No cards yet'
                : 'Nested board'}
          </div>
        )}
      </div>
      <NodeHandles connectable={!link.locked} />
    </div>
    </>
  );
}

export default memo(BoardLinkNodeView);
