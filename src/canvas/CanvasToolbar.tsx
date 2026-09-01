import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Maximize, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Undo2 } from 'lucide-react';
import { useBoardStore } from '@/state/boardStore';
import { usePlaceAtCentre } from '@/canvas/dragCreate';
import { PaletteMenuItems, usePaletteOpen, type PaletteEntry } from '@/canvas/Palette';
import {
  NO_SELECTION,
  SelectionCaption,
  SelectionItemRow,
  SelectionOpsContext,
  runSelectionAction,
  selectionMenuItems,
  useSelectionSize,
  type SelectionMenuItem,
} from '@/canvas/SelectionMenu';
import Tooltip from '@/components/Tooltip';

/**
 * The floating toolbar (spec 8.3).
 *
 * Bottom-centre, because every other edge of the canvas is spoken for — the
 * palette on the left, the save and selection chips bottom left, React Flow's
 * zoom controls bottom right, the bar above — and because that is where every
 * tool of this kind puts one, so the hand goes there before the eye does.
 *
 * It holds the actions people otherwise hunt through menus for, and each one
 * names its key. Spec 9's table is otherwise reachable only by pressing `?`,
 * which is itself only discoverable by reading spec 9.
 *
 * Nothing here subscribes to the viewport: a live zoom readout would re-render
 * this bar on every frame of a pan, and the marquee is drawn on those frames.
 */

const FIT_VIEW_OPTIONS = { padding: 0.2, duration: 200, maxZoom: 1 };

export default function CanvasToolbar(): JSX.Element {
  const { fitView, zoomTo } = useReactFlow();
  const undo = useBoardStore((s) => s.undo);
  const redo = useBoardStore((s) => s.redo);
  const canUndo = useBoardStore((s) => s.undoStack.length > 0);
  const canRedo = useBoardStore((s) => s.redoStack.length > 0);
  const paletteOpen = usePaletteOpen((s) => s.open);
  const togglePalette = usePaletteOpen((s) => s.toggle);

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      className="absolute bottom-3 left-1/2 z-[2100] flex -translate-x-1/2 items-center rounded-[var(--radius-md)] border border-line bg-raised p-1 shadow-[shadow:var(--shadow-overlay)]"
    >
      <AddMenu open={menuOpen} onOpenChange={setMenuOpen} />

      <Rule />

      <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo} icon={<Undo2 size={16} />} />
      <ToolButton
        label="Redo"
        shortcut="Ctrl+Shift+Z"
        disabled={!canRedo}
        onClick={redo}
        icon={<Redo2 size={16} />}
      />

      <Rule />

      <ToolButton
        label="Zoom to fit"
        shortcut="Ctrl+0"
        onClick={() => void fitView(FIT_VIEW_OPTIONS)}
        icon={<Maximize size={16} />}
      />
      <ToolButton
        label="Zoom to 100%"
        shortcut="Ctrl+1"
        wide
        onClick={() => void zoomTo(1, { duration: 200 })}
        icon={<span className="text-[11px] leading-none">100%</span>}
      />

      <Rule />

      <ToolButton
        label={paletteOpen ? 'Hide the palette' : 'Show the palette'}
        pressed={paletteOpen}
        onClick={togglePalette}
        icon={paletteOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

function Rule(): JSX.Element {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[var(--line)]" aria-hidden />;
}

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  /** A toggle that is on. */
  pressed?: boolean;
  /** A trigger whose menu is open. */
  expanded?: boolean;
  /** Holds text rather than an icon, so it sizes to what it says. */
  wide?: boolean;
  disabled?: boolean;
  onClick(): void;
}

/**
 * `IconButton` carries a native `title` as well, and two tooltips over one
 * button is worse than either — so this is the same `karta-icon-btn` surface
 * with the hint left to `Tooltip`, which appears at once for the keyboard.
 * That is the whole point of putting the keys down here.
 */
function ToolButton({
  label,
  shortcut,
  icon,
  pressed,
  expanded,
  wide,
  disabled,
  onClick,
}: ToolButtonProps): JSX.Element {
  return (
    <Tooltip label={shortcut ? `${label} · ${shortcut}` : label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-haspopup={expanded === undefined ? undefined : 'menu'}
        disabled={disabled}
        onClick={onClick}
        className={`karta-icon-btn ${wide === true ? 'w-auto px-2' : ''} aria-expanded:border-[var(--line-control)] aria-expanded:bg-sunken aria-expanded:text-ink`}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ *
 * The add menu
 * ------------------------------------------------------------------ */

/**
 * The palette's list again, for when the palette is collapsed or the pointer is
 * already down here. It places at the centre of the view; dragging to an exact
 * spot is what the palette is for, so these do not pretend to be draggable.
 *
 * Under it, the two things that are made *out of* what is already on the board
 * rather than out of nothing — a frame around the selection, and a nested board
 * holding it. Both are additions, both make a node kind the palette cannot, and
 * both were reachable by a key alone until this menu named them.
 */
function AddMenu({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }): JSX.Element {
  const placeAtCentre = usePlaceAtCentre();
  const root = useRef<HTMLDivElement>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;

    root.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The canvas reads Escape as "clear the selection"; here it means the menu.
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      close();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [close, open]);

  const pick = useCallback(
    (entry: PaletteEntry): void => {
      placeAtCentre(entry.choice);
      close();
    },
    [close, placeAtCentre],
  );

  return (
    <div ref={root} className="relative flex items-center">
      <ToolButton
        label="Add to the board"
        icon={<Plus size={16} />}
        expanded={open}
        onClick={() => onOpenChange(!open)}
      />

      {open ? (
        <div
          role="menu"
          aria-label="Add to the board"
          className="absolute bottom-full left-1/2 mb-2 w-[224px] -translate-x-1/2 rounded-[var(--radius-md)] border border-line bg-raised p-2 shadow-[shadow:var(--shadow-overlay)]"
        >
          <PaletteMenuItems onPick={pick} />
          <FromSelection onDone={close} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * *Group into a frame* and *Extract to a nested board*, in the toolbar's own
 * menu and off the one list the menu on the selection reads (`SelectionMenu`),
 * so the two namings of an operation cannot come apart. Dimmed rather than
 * hidden when the selection cannot bear them, with the reason in the tooltip.
 *
 * The selection is subscribed to here rather than in the toolbar itself, and
 * this only exists while the menu is open — so a marquee, which changes the
 * count on every frame it catches something, costs the bar nothing at all.
 */
function FromSelection({ onDone }: { onDone(): void }): JSX.Element | null {
  const ops = useContext(SelectionOpsContext);
  const size = useSelectionSize();
  if (!ops) return null;

  // The counts are what re-renders this list; the facts behind them are read
  // from the document at the moment it renders.
  const facts = size.nodes + size.edges === 0 ? NO_SELECTION : ops.facts();
  const items = selectionMenuItems(facts).filter(
    (item) => item.action === 'group' || item.action === 'extract',
  );

  const pick = (item: SelectionMenuItem): void => {
    if (!item.enabled) return;
    runSelectionAction(ops, item.action);
    onDone();
  };

  return (
    <>
      <hr className="my-2 border-line" />
      <SelectionCaption>From the selection</SelectionCaption>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          // This menu is the palette's width, so the key rides in the tooltip
          // the way a palette item's does.
          <SelectionItemRow key={item.action} item={item} onPick={pick} showShortcut={false} />
        ))}
      </div>
    </>
  );
}
