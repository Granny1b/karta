import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { NodeToolbar, Position } from '@xyflow/react';
import {
  Copy,
  Frame,
  Lock,
  MoreHorizontal,
  Palette as PaletteIcon,
  SquareArrowOutUpRight,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { BoardNode, ColorToken, Id } from '@/domain/board';
import { TEMPER_TOKENS, colorValue } from '@/lib/colors';
import { cx } from '@/canvas/cx';
import { SelectionScope } from '@/canvas/soleSelection';
import type { SelectionCounts } from '@/canvas/useSelection';

/**
 * What a selection can be *done to* (spec 5.2, spec 9).
 *
 * The palette answers "how do I put something on the board". This answers the
 * other half — "I have chosen these; now what?" — and until it existed two of
 * the seven node kinds had no mouse path at all: a frame was `Ctrl+G` and a
 * nested board was `Ctrl+Shift+B`, both of them written down only in a dialog
 * behind `?`. A feature reachable solely by a key nobody has been told about is
 * a feature that does not exist, and the two hidden here were the ones that
 * make a board a map rather than one endless sheet.
 *
 * So: the same operations the keyboard already runs, named, reachable with the
 * right button or with a button drawn on the selection itself, and each one
 * carrying the key that does the same thing — which is also how the section 9
 * table stops being a secret. Nothing here reimplements an operation; every
 * item calls the handler the shortcut calls.
 */

/* ------------------------------------------------------------------ *
 * What the selection is — the pure half
 * ------------------------------------------------------------------ */

export type SelectionAction = 'group' | 'extract' | 'duplicate' | 'colour' | 'lock' | 'unlock' | 'delete';

/** The few counts every decision on this menu is made from. */
export interface SelectionFacts {
  /** Selected nodes that really are on the board. */
  nodes: number;
  edges: number;
  locked: number;
  unlocked: number;
  /** Selected nodes a frame can be drawn around — everything but a frame itself. */
  framable: number;
}

export const NO_SELECTION: SelectionFacts = {
  nodes: 0,
  edges: 0,
  locked: 0,
  unlocked: 0,
  framable: 0,
};

/**
 * The facts, read from the document rather than from the flow arrays — a
 * selected id the document no longer holds is not a node, and an item that
 * counted it would offer to duplicate nothing.
 */
export function readSelectionFacts(
  nodes: readonly BoardNode[],
  selected: ReadonlySet<Id>,
  edges: number,
): SelectionFacts {
  if (selected.size === 0) return { ...NO_SELECTION, edges };

  let count = 0;
  let locked = 0;
  let framable = 0;
  for (const node of nodes) {
    if (!selected.has(node.id)) continue;
    count += 1;
    if (node.locked) locked += 1;
    if (node.kind !== 'group') framable += 1;
  }

  return { nodes: count, edges, locked, unlocked: count - locked, framable };
}

export interface SelectionMenuItem {
  action: SelectionAction;
  label: string;
  /** The key that does the same thing (spec 9), where there is one. */
  shortcut: string | null;
  enabled: boolean;
  /** Why it is off, in the voice the toasts use. `null` while it is on. */
  reason: string | null;
}

const NOTHING = 'Nothing is selected';
const ALL_LOCKED = 'Everything selected is locked';

/**
 * The menu for a given selection.
 *
 * Every item is always present. An operation that has quietly vanished teaches
 * nobody it exists, and a menu whose length changes with the selection cannot
 * be learned by the hand — so what does not apply is dimmed and says why.
 *
 * The reasons are the rules the handlers in `Canvas` really follow: `frameAround`
 * skips frames, `applyColor` and `removeSelection` skip locked nodes, and
 * `extractToBoard` moves whatever is selected, lock or no lock.
 */
export function selectionMenuItems(facts: SelectionFacts): SelectionMenuItem[] {
  const anything = facts.nodes > 0 || facts.edges > 0;
  const writable = facts.unlocked > 0 || facts.edges > 0;

  const noNodes = facts.nodes === 0 ? NOTHING : null;
  const nothingWritable = anything ? ALL_LOCKED : NOTHING;

  return [
    {
      action: 'group',
      label: 'Group into a frame',
      shortcut: 'Ctrl+G',
      enabled: facts.framable > 0,
      reason: facts.framable > 0 ? null : (noNodes ?? 'A frame cannot be put inside another frame'),
    },
    {
      action: 'extract',
      label: 'Extract to a nested board',
      shortcut: 'Ctrl+Shift+B',
      enabled: facts.nodes > 0,
      reason: noNodes,
    },
    {
      action: 'duplicate',
      label: 'Duplicate',
      shortcut: 'Ctrl+D',
      enabled: facts.nodes > 0,
      reason: noNodes,
    },
    {
      action: 'colour',
      label: 'Colour',
      shortcut: '1–7',
      enabled: writable,
      reason: writable ? null : nothingWritable,
    },
    // One or the other, never both: a mixed selection locks, because that is
    // the state the user is asking for by choosing an unlocked node at all.
    facts.locked > 0 && facts.unlocked === 0
      ? {
          action: 'unlock',
          label: 'Unlock',
          shortcut: null,
          enabled: true,
          reason: null,
        }
      : {
          action: 'lock',
          label: 'Lock',
          shortcut: null,
          enabled: facts.unlocked > 0,
          reason: noNodes,
        },
    {
      action: 'delete',
      label: 'Delete',
      shortcut: 'Delete',
      enabled: writable,
      reason: writable ? null : nothingWritable,
    },
  ];
}

/**
 * Where the caret lands after a key, wrapping the way the palette's does.
 * `from` is where it is now, and `-1` — what `indexOf` answers for a focus that
 * is not in the list at all — means "not yet in the menu", from which the first
 * arrow lands on the end it came from rather than off the end.
 */
export function moveFocus(key: string, from: number, count: number): number | null {
  if (count <= 0) return null;
  const at = from < 0 || from >= count ? -1 : from;
  switch (key) {
    // One order for both axes, as in the palette: the rows and the swatch strip
    // are a single list, and guessing which axis a mixed layout walks is worse
    // than not asking.
    case 'ArrowDown':
    case 'ArrowRight':
      return at === -1 ? 0 : (at + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return at === -1 ? count - 1 : (at - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * The operations, as the canvas offers them
 * ------------------------------------------------------------------ */

/**
 * The canvas's own selection commands, handed to whatever wants to name them.
 * These are the very functions `useCanvasShortcuts` is wired to, so a menu item
 * and its key cannot drift apart — there is only one of each.
 */
export interface SelectionOps {
  facts(): SelectionFacts;
  selectedNodeIds(): Id[];
  /** Open the menu at a point in viewport pixels — a pointer, or a button's corner. */
  openMenuAt(screen: { x: number; y: number }): void;
  group(): void;
  extract(): void;
  duplicate(): void;
  applyColor(color: ColorToken): void;
  setLocked(locked: boolean): void;
  remove(): void;
}

export const SelectionOpsContext = createContext<SelectionOps | null>(null);

/** Runs one item. Exported so the wiring is checkable without a DOM. */
export function runSelectionAction(ops: SelectionOps, action: SelectionAction): void {
  switch (action) {
    case 'group':
      ops.group();
      return;
    case 'extract':
      ops.extract();
      return;
    case 'duplicate':
      ops.duplicate();
      return;
    case 'lock':
      ops.setLocked(true);
      return;
    case 'unlock':
      ops.setLocked(false);
      return;
    case 'delete':
      ops.remove();
      return;
    case 'colour':
      // The row of swatches carries this one; there is no single colour to apply.
      return;
    default:
      return;
  }
}

const NO_COUNTS: SelectionCounts = { nodes: 0, edges: 0 };

function neverChanges(): () => void {
  return () => undefined;
}

/**
 * The live selection size, from the canvas's tracker. It notifies only when a
 * count changes, so a marquee that catches nothing re-renders nothing — which
 * is the whole reason the tracker exists (`useSelection`).
 */
export function useSelectionSize(): SelectionCounts {
  const source = useContext(SelectionScope);
  const snapshot = useCallback((): SelectionCounts => source?.counts() ?? NO_COUNTS, [source]);
  return useSyncExternalStore(source?.subscribe ?? neverChanges, snapshot, snapshot);
}

/* ------------------------------------------------------------------ *
 * The menu
 * ------------------------------------------------------------------ */

/** Kept clear of the canvas edge so the menu never opens half off-screen. */
const EDGE_MARGIN = 8;

/**
 * The surface the toolbar's own menu wears, and the connect menu's stacking:
 * over the palette and the toolbar at 2100, because a menu is the thing that
 * was just asked for and it opens wherever the pointer happened to be.
 *
 * Wide enough that *Extract to a nested board* and its key both fit on one
 * line. A menu whose longest item is elided is a menu that has to be guessed at.
 */
const SURFACE = 'nodrag nopan absolute z-[2200] w-[300px] rounded-md border border-line bg-raised p-2 shadow-overlay';

/** A group heading in the palette's voice, and on the right the key for the group. */
export function SelectionCaption({
  children,
  hint = null,
  dim = false,
}: {
  children: string;
  hint?: string | null;
  dim?: boolean;
}): JSX.Element {
  return (
    <p
      className={cx(
        'flex items-baseline justify-between gap-2 px-2 pb-1 text-meta leading-flat text-ink-muted',
        dim && 'opacity-40',
      )}
      aria-hidden
    >
      <span>{children}</span>
      {hint === null ? null : <span>{hint}</span>}
    </p>
  );
}

const ROW =
  'flex h-7 w-full items-center gap-2 rounded px-2 text-left text-caption transition-colors duration-fast ease-linear';

/**
 * The row's own hover, off the same tokens every other control reads. Delete
 * warms to the destructive ink on the way in — `--danger`, which is copper by
 * day and a copper that can still be read by night — and it is written here
 * rather than borrowed from `.karta-danger` so a utility and a stylesheet are
 * not left to argue over one hover.
 */
function rowClass(enabled: boolean, danger: boolean): string {
  if (!enabled) return cx(ROW, 'cursor-default text-ink-muted opacity-40');
  return cx(
    ROW,
    'group text-ink-muted hover:bg-hover',
    danger ? 'hover:text-danger' : 'hover:text-ink',
  );
}

const ICONS: Record<SelectionAction, typeof Copy> = {
  group: Frame,
  extract: SquareArrowOutUpRight,
  duplicate: Copy,
  colour: PaletteIcon,
  lock: Lock,
  unlock: Unlock,
  delete: Trash2,
};

/** Name first, then the key — the order the shortcuts dialog reads in. */
function itemTitle(item: SelectionMenuItem): string {
  if (!item.enabled) return item.reason ?? item.label;
  return item.shortcut ? `${item.label} · ${item.shortcut}` : item.label;
}

export interface SelectionItemRowProps {
  item: SelectionMenuItem;
  onPick(item: SelectionMenuItem): void;
  /**
   * Whether the key is drawn beside the name. The menu on the selection is wide
   * enough to say both; the toolbar's menu is the palette's width and keeps the
   * key in the tooltip, the way a palette item does.
   */
  showShortcut?: boolean;
  /**
   * In the tab order, or reached by the arrow keys. A roving menu holds one
   * tab stop and moves the caret itself; the toolbar's menu is a plain list of
   * tabbable items, and its rows must not become the one hole in it.
   */
  tabbable?: boolean;
}

/**
 * One row, wherever the list is shown. Exported because the toolbar's menu
 * offers the same two operations, and two renderings of one row is two chances
 * for them to drift apart.
 */
export function SelectionItemRow({
  item,
  onPick,
  showShortcut = true,
  tabbable = true,
}: SelectionItemRowProps): JSX.Element {
  const Icon = ICONS[item.action];
  const danger = item.action === 'delete';
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={tabbable ? 0 : -1}
      // Dimmed rather than disabled: a disabled control cannot be focused, and
      // an item that cannot be focused cannot tell anyone why it is off.
      aria-disabled={item.enabled ? undefined : true}
      title={itemTitle(item)}
      onClick={() => onPick(item)}
      className={rowClass(item.enabled, danger)}
    >
      <span className="flex h-3.5 w-5 shrink-0 items-center justify-center">
        <Icon size={14} aria-hidden />
      </span>
      <span
        className={cx(
          'min-w-0 flex-1 truncate',
          item.enabled && 'text-ink',
          item.enabled && danger && 'group-hover:text-danger',
        )}
      >
        {item.label}
      </span>
      {showShortcut && item.shortcut !== null ? (
        <span className="shrink-0 text-meta leading-flat">{item.shortcut}</span>
      ) : null}
    </button>
  );
}

interface ColourRowProps {
  item: SelectionMenuItem;
  onPick(color: ColorToken): void;
}

/**
 * The seven temper colours, in the row `EdgeToolbar` and the shape editor
 * already use — same swatch, same size, same order as the `1`–`7` keys.
 */
function ColourRow({ item, onPick }: ColourRowProps): JSX.Element {
  return (
    <div role="group" aria-label={item.enabled ? 'Colour' : `Colour — ${item.reason ?? ''}`.trim()}>
      <SelectionCaption hint={item.shortcut} dim={!item.enabled}>
        {item.label}
      </SelectionCaption>
      <div className="flex items-center gap-1 px-2 pb-0.5">
        {TEMPER_TOKENS.map((token) => (
          <button
            key={token}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.enabled ? undefined : true}
            aria-label={token}
            title={item.enabled ? token : (item.reason ?? token)}
            onClick={() => onPick(token)}
            className={cx('karta-swatch', !item.enabled && 'cursor-default opacity-40')}
            style={{ background: colorValue(token) }}
          />
        ))}
      </div>
    </div>
  );
}

export interface SelectionMenuProps {
  /** Position within the canvas wrapper, in pixels. */
  x: number;
  y: number;
  onClose(): void;
}

/**
 * The menu itself: the right button on a selected node, and the button drawn on
 * the selection's own bounding box, open this same list at the same size.
 *
 * It sits in the wrapper's pixels rather than the board's, like the connect
 * menu, because it belongs to the pointer that opened it and not to a place on
 * the field — it must not drift while it is open.
 */
export default function SelectionMenu({ x, y, onClose }: SelectionMenuProps): JSX.Element | null {
  const ops = useContext(SelectionOpsContext);
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  // Read once, when the menu opens: every item closes it, so there is no state
  // of the board a still-open menu could be wrong about.
  const items = useMemo(() => selectionMenuItems(ops?.facts() ?? NO_SELECTION), [ops]);

  // Measured before paint: the menu is a fixed size, so where it can sit is
  // known as soon as it exists and it never has to be seen moving.
  useLayoutEffect(() => {
    const el = root.current;
    const parent = el?.offsetParent;
    if (!el || !(parent instanceof HTMLElement)) return;
    const maxLeft = Math.max(EDGE_MARGIN, parent.clientWidth - el.offsetWidth - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, parent.clientHeight - el.offsetHeight - EDGE_MARGIN);
    setAt({
      left: Math.min(Math.max(x, EDGE_MARGIN), maxLeft),
      top: Math.min(Math.max(y, EDGE_MARGIN), maxTop),
    });
  }, [x, y]);

  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The canvas reads Escape as "clear the selection"; here it means the menu.
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      onClose();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  const onMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      // A menu is one stop in the tab order, not seven: Tab leaves, and leaving
      // closes it rather than stranding the caret on a list nobody can see.
      if (event.key === 'Tab') {
        onClose();
        return;
      }

      const el = root.current;
      if (!el) return;
      const buttons = [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = moveFocus(event.key, from, buttons.length);
      if (next === null) return;

      event.preventDefault();
      // Otherwise the same arrow also nudges whatever is selected behind here.
      event.stopPropagation();
      buttons[next]?.focus();
    },
    [onClose],
  );

  const pick = useCallback(
    (item: SelectionMenuItem): void => {
      if (!ops || !item.enabled) return;
      runSelectionAction(ops, item.action);
      onClose();
    },
    [onClose, ops],
  );

  const pickColour = useCallback(
    (color: ColorToken): void => {
      const colour = items.find((item) => item.action === 'colour');
      if (!ops || colour?.enabled !== true) return;
      ops.applyColor(color);
      onClose();
    },
    [items, onClose, ops],
  );

  if (!ops) return null;

  const colour = items.find((item) => item.action === 'colour');
  /** The rows of one section, in the order the list itself is built in. */
  const rows = (wanted: readonly SelectionAction[]): JSX.Element[] =>
    items
      .filter((item) => wanted.includes(item.action))
      .map((item) => <SelectionItemRow key={item.action} item={item} onPick={pick} tabbable={false} />);

  return (
    <div
      ref={root}
      role="menu"
      aria-label="Do this to the selection"
      className={SURFACE}
      style={at}
      onKeyDown={onMenuKeyDown}
    >
      <p className="karta-menu-title" aria-hidden>
        Selection
      </p>

      {/* The two that make a node out of the selection, which is what nothing
          but a keystroke could reach before. */}
      <div className="flex flex-col gap-1">{rows(['group', 'extract'])}</div>

      <hr className="my-2 border-line" />

      {/* ...and the ones that act on it where it stands. */}
      <div className="flex flex-col gap-1">
        {rows(['duplicate'])}
        {colour ? <ColourRow item={colour} onPick={pickColour} /> : null}
        {rows(['lock', 'unlock', 'delete'])}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The affordance on the selection
 * ------------------------------------------------------------------ */

/**
 * The button drawn above the selection's own bounding box.
 *
 * The right button is the fast way in and the only one most people will use
 * twice — but nobody right-clicks a thing they have not been told is
 * right-clickable, so the selection also wears the menu where it can be seen
 * and tabbed to.
 *
 * `NodeToolbar` places it against the union of the selected nodes and follows
 * them itself, so panning and dragging cost this component nothing: it renders
 * when the size of the selection changes, and at no other point in a marquee.
 */
export function SelectionAffordance(): JSX.Element | null {
  const ops = useContext(SelectionOpsContext);
  const counts = useSelectionSize();
  const button = useRef<HTMLButtonElement>(null);

  const open = useCallback((): void => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect || !ops) return;
    ops.openMenuAt({ x: rect.left, y: rect.bottom + 4 });
  }, [ops]);

  if (!ops || counts.nodes === 0) return null;

  return (
    <NodeToolbar
      nodeId={ops.selectedNodeIds()}
      isVisible
      position={Position.Top}
      align="end"
      offset={10}
      className="karta-node-toolbar nodrag nopan nowheel flex items-center p-0.5"
    >
      <button
        ref={button}
        type="button"
        aria-label="Do this to the selection"
        aria-haspopup="menu"
        title="Do this to the selection"
        className="karta-tool-btn karta-tool-icon"
        onClick={open}
      >
        <MoreHorizontal size={14} />
      </button>
    </NodeToolbar>
  );
}
