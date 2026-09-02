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
import { Pencil, Settings, SquareArrowOutUpRight } from 'lucide-react';
import { NodeToolbar, Position } from '@xyflow/react';
import { MAX_TITLE, capText, type ColorToken } from '@/domain/board';
import { renameBoard } from '@/board/renameBoard';
import { takeRenameOnMount } from '@/canvas/createSubBoard';
import { clickedOutside } from '@/canvas/dismiss';
import { useSoleNodeSelected } from '@/canvas/soleSelection';
import { useBoardStore } from '@/state/boardStore';
import { isEditableTarget } from '@/lib/keys';
import { TEMPER_TOKENS, colorValue } from '@/lib/colors';
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
  const gear = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const title = link.cachedTitle.trim().length > 0 ? link.cachedTitle : 'Board';

  const [menuOpen, setMenuOpen] = useState(false);

  const setColour = useCallback(
    (next: ColorToken | null): void => {
      // The menu stays open: picking a colour is the kind of choice people make
      // two or three times before they settle, and closing after each one turns
      // a comparison into four round trips through the gear.
      useBoardStore.getState().updateNode(link.id, { color: next }, 'Recolour board link');
    },
    [link.id],
  );

  /*
   * Dismissal.
   *
   * The menu is rendered by `NodeToolbar` into a portal, so it is NOT inside
   * the gear that opened it. Exempting only the gear made every click on the
   * menu an outside click: it closed on `pointerdown` and the `click` that
   * would have chosen something never reached a mounted element. The menu
   * opened, and then did nothing.
   */
  useEffect(() => {
    if (!menuOpen) return undefined;

    const onPointerDown = (event: PointerEvent): void => {
      if (clickedOutside(event.target, [gear.current, menu.current])) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenuOpen(false);
      gear.current?.focus();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [menuOpen]);

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
      {/*
        Settings hang off the top-right corner rather than below the tile: the
        bottom edge belongs to the connection handle, and a button sitting on it
        is a button fighting the gesture the handle exists for.
      */}
      {menuOpen && !link.locked && (
        <NodeToolbar
          position={Position.Top}
          align="end"
          offset={8}
          className="karta-node-toolbar"
          isVisible
        >
          <div ref={menu} className="flex flex-col gap-1 p-1" role="menu" aria-label="Board settings">
            <button
              type="button"
              role="menuitem"
              className="karta-tool-btn flex h-7 items-center gap-2 px-2 text-left text-caption"
              onClick={() => {
                setMenuOpen(false);
                beginRename();
              }}
            >
              <Pencil size={13} aria-hidden />
              <span className="flex-1">Rename</span>
              <span className="text-meta text-ink-muted">F2</span>
            </button>

            <div className="karta-toolbar-row">
              <span className="karta-toolbar-label" id={`${link.id}-colour`}>
                Colour
              </span>
              <div
                className="ml-auto flex items-center gap-1"
                role="group"
                aria-labelledby={`${link.id}-colour`}
              >
                <button
                  type="button"
                  className="karta-swatch"
                  title="No colour"
                  aria-label="No colour"
                  style={{ background: 'var(--surface-raised)' }}
                  onClick={() => setColour(null)}
                />
                {TEMPER_TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    className="karta-swatch"
                    title={token}
                    aria-label={token}
                    style={{ background: colorValue(token) }}
                    onClick={() => setColour(token)}
                  />
                ))}
              </div>
            </div>
          </div>
        </NodeToolbar>
      )}

    <div
      className={root}
      onDoubleClick={editing ? undefined : open}
      title={editing ? undefined : `${title} — double-click to open, F2 to rename`}
    >
      <span className="karta-colorbar" style={{ background: accent }} aria-hidden />

      {/* Shown on hover or while selected, so a board full of tiles stays a
          board full of tiles. */}
      {!link.locked && !editing && (
        <button
          ref={gear}
          type="button"
          className={cx(
            'karta-boardlink-gear nodrag',
            (selected === true || menuOpen) && 'is-on',
          )}
          title="Board settings"
          aria-label="Board settings"
          aria-expanded={menuOpen}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          <Settings size={13} aria-hidden />
        </button>
      )}
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
          <div className="text-control text-ink-muted">
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
