import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { create } from 'zustand';
import { ChevronsLeft, PanelLeftOpen, Shapes } from 'lucide-react';
import { readLocal, writeLocal } from '@/lib/storage';
import type { ConnectChoice } from '@/canvas/connect';
import { SHAPE_GEOMETRY, SHAPE_LABEL, SHAPE_ORDER } from '@/canvas/shapes';
import { usePlaceAtCentre, writePaletteDrag } from '@/canvas/dragCreate';
import IconButton from '@/components/IconButton';

/**
 * The palette (spec 8.3): the standing answer to "how do I put something on
 * this board". It sits over the canvas on the left, the way the board tree
 * does, and never resizes it.
 *
 * Every item works two ways, because both are muscle memory somewhere: click it
 * and the thing appears in the middle of the view, or drag it and it appears
 * where it is dropped. The shapes are drawn from the same geometry the nodes
 * are drawn from — what the palette shows is the silhouette that is about to
 * exist, not an icon that resembles it.
 *
 * Collapsed, it keeps the three card kinds one click away and gets out of the
 * way. That choice is remembered, so a board opens the way it was left.
 */

const KEY_OPEN = 'karta:palette';

export interface PaletteOpenState {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
}

/**
 * Open unless it was closed by hand: the palette is the discoverable way in, so
 * a board nobody has expressed an opinion about shows it.
 *
 * It lives here rather than in `uiStore` because the only other reader is the
 * canvas toolbar's button for it, one file away.
 */
export const usePaletteOpen = create<PaletteOpenState>()((set, get) => ({
  open: readLocal(KEY_OPEN) !== 'closed',
  setOpen(open) {
    set({ open });
    writeLocal(KEY_OPEN, open ? 'open' : 'closed');
  },
  toggle() {
    get().setOpen(!get().open);
  },
}));

export interface PaletteEntry {
  choice: ConnectChoice;
  label: string;
  /** The key that does the same thing, where spec 9 gives one. */
  shortcut: string | null;
}

/** The three things a blank board is usually started with. */
const CARD_ENTRIES: readonly PaletteEntry[] = [
  { choice: { kind: 'card' }, label: 'Card', shortcut: 'N' },
  { choice: { kind: 'note' }, label: 'Note', shortcut: 'Shift+N' },
  { choice: { kind: 'text' }, label: 'Text', shortcut: null },
];

const SHAPE_ENTRIES: readonly PaletteEntry[] = SHAPE_ORDER.map((shape) => ({
  choice: { kind: 'shape', shape },
  label: SHAPE_LABEL[shape],
  shortcut: null,
}));

/** Name first, then the key — the order the shortcuts dialog reads in. */
function entryTitle(entry: PaletteEntry): string {
  return entry.shortcut ? `${entry.label} · ${entry.shortcut}` : entry.label;
}

/** Loads a drag with the item it started from. The ghost is the item itself. */
function startPaletteDrag(event: ReactDragEvent<HTMLElement>, entry: PaletteEntry): void {
  writePaletteDrag(event.dataTransfer, entry.choice, entry.label);
  event.dataTransfer.effectAllowed = 'copy';
}

/* ------------------------------------------------------------------ *
 * Glyphs
 * ------------------------------------------------------------------ */

/** One box for every glyph, so nothing in the palette is sized by eye. */
const GLYPH = { w: 20, h: 14, pad: 1 };

const GLYPH_BOX = `${-GLYPH.pad} ${-GLYPH.pad} ${GLYPH.w + GLYPH.pad * 2} ${GLYPH.h + GLYPH.pad * 2}`;

/**
 * What each kind looks like at 20 × 14. The card carries its colour bar and the
 * note its folded corner, because those are the two marks that tell them apart
 * on the canvas as well.
 */
function glyphBody(choice: ConnectChoice): JSX.Element {
  switch (choice.kind) {
    case 'card':
      return (
        <>
          <rect x={0.5} y={0.5} width={19} height={13} rx={2} />
          <path
            d="M2.5 0.5H4V13.5H2.5A2 2 0 0 1 0.5 11.5V2.5A2 2 0 0 1 2.5 0.5Z"
            fill="var(--temper-slate)"
            stroke="none"
          />
          <path d="M6.5 5H14.5M6.5 8.5H11.5" opacity={0.55} strokeLinecap="round" />
        </>
      );
    case 'note':
      return (
        <>
          <path
            d="M3.5 0.5H16.5V9L12 13.5H3.5Z"
            fill="color-mix(in srgb, var(--temper-straw) 30%, transparent)"
          />
          <path d="M16.5 9H12V13.5" />
        </>
      );
    case 'text':
      return <path d="M4.5 3H15.5M10 3V11.5" strokeLinecap="round" />;
    default:
      return <path d={SHAPE_GEOMETRY[choice.shape].path(GLYPH.w, GLYPH.h)} />;
  }
}

/** The silhouette of what an item makes. Takes its line from `currentColor`. */
function PaletteGlyph({ choice }: { choice: ConnectChoice }): JSX.Element {
  return (
    <svg
      width={GLYPH.w}
      height={GLYPH.h}
      viewBox={GLYPH_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {glyphBody(choice)}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

export type ItemLayout = 'row' | 'cell';

/**
 * One item's surface, hover and press, off the same tokens every other control
 * in the product reads. Exported because the toolbar's menu is the same item
 * under a different role, and two hover treatments for one control is exactly
 * the kind of drift that reads as cheap.
 */
function paletteItemClass(layout: ItemLayout): string {
  const shared =
    'flex w-full items-center rounded-[var(--radius-sm)] text-ink-muted transition-colors duration-[var(--dur-fast)] ease-linear hover:bg-[var(--surface-hover)] hover:text-ink active:bg-[var(--surface-active)]';
  return layout === 'row' ? `${shared} h-7 gap-2 px-2 text-left` : `${shared} h-8 justify-center`;
}

/** Glyph, and in a row the name and the key beside it. */
function PaletteItemFace({ entry, layout }: { entry: PaletteEntry; layout: ItemLayout }): JSX.Element {
  return (
    <>
      <span className="flex h-3.5 w-5 shrink-0 items-center justify-center">
        <PaletteGlyph choice={entry.choice} />
      </span>
      {layout === 'row' ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{entry.label}</span>
          {entry.shortcut ? <span className="shrink-0 text-[11px] leading-none">{entry.shortcut}</span> : null}
        </>
      ) : null}
    </>
  );
}

interface ItemProps {
  entry: PaletteEntry;
  index: number;
  tabbable: boolean;
  layout: ItemLayout;
  onFocusItem(index: number): void;
  onPick(entry: PaletteEntry): void;
  register(index: number, el: HTMLButtonElement | null): void;
}

function Item({ entry, index, tabbable, layout, onFocusItem, onPick, register }: ItemProps): JSX.Element {
  return (
    <button
      ref={(el) => {
        register(index, el);
      }}
      type="button"
      draggable
      tabIndex={tabbable ? 0 : -1}
      title={entryTitle(entry)}
      aria-label={entryTitle(entry)}
      onFocus={() => onFocusItem(index)}
      onDragStart={(event) => startPaletteDrag(event, entry)}
      onClick={() => onPick(entry)}
      className={paletteItemClass(layout)}
    >
      <PaletteItemFace entry={entry} layout={layout} />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

const PANEL =
  'absolute left-3 top-3 z-[2100] flex flex-col rounded-[var(--radius-md)] border border-line bg-raised shadow-[shadow:var(--shadow-overlay)]';

export default function Palette(): JSX.Element {
  const open = usePaletteOpen((s) => s.open);
  const setOpen = usePaletteOpen((s) => s.setOpen);
  const placeAtCentre = usePlaceAtCentre();

  const headingId = useId();
  const cardsId = useId();
  const shapesId = useId();

  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);

  // The rail carries the card kinds only, so collapsing has to walk the roving
  // tab stop back into what is left of the list.
  const count = open ? CARD_ENTRIES.length + SHAPE_ENTRIES.length : CARD_ENTRIES.length;
  const activeIndex = Math.min(active, count - 1);

  const register = useCallback((index: number, el: HTMLButtonElement | null): void => {
    items.current[index] = el;
  }, []);

  const pick = useCallback(
    (entry: PaletteEntry): void => {
      placeAtCentre(entry.choice);
    },
    [placeAtCentre],
  );

  // Expanding from the rail's shapes button lands the caret on the first shape,
  // which is the only reason that button is worth pressing.
  useEffect(() => {
    if (pendingFocus === null) return;
    items.current[pendingFocus]?.focus();
    setActive(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      let next: number;
      switch (event.key) {
        // One order for both axes: the rows and the grid are a single list, and
        // guessing which axis a mixed layout walks is worse than not asking.
        case 'ArrowDown':
        case 'ArrowRight':
          next = (activeIndex + 1) % count;
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          next = (activeIndex - 1 + count) % count;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = count - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      // Otherwise the same arrow also nudges whatever is selected behind here.
      event.stopPropagation();
      setActive(next);
      items.current[next]?.focus();
    },
    [activeIndex, count],
  );

  if (!open) {
    return (
      <aside aria-label="Palette" className={`${PANEL} w-10 items-center gap-1 p-1`}>
        <IconButton
          size="sm"
          label="Show the palette"
          icon={<PanelLeftOpen size={16} />}
          onClick={() => setOpen(true)}
        />
        <Divider />
        <div
          role="toolbar"
          aria-orientation="vertical"
          aria-label="Add to the board"
          onKeyDown={onKeyDown}
          className="flex w-full flex-col items-center gap-1"
        >
          {CARD_ENTRIES.map((entry, index) => (
            <Item
              key={entry.label}
              entry={entry}
              index={index}
              layout="cell"
              tabbable={index === activeIndex}
              onFocusItem={setActive}
              onPick={pick}
              register={register}
            />
          ))}
        </div>
        <Divider />
        <IconButton
          size="sm"
          label="Shapes"
          icon={<Shapes size={16} />}
          onClick={() => {
            setOpen(true);
            setPendingFocus(CARD_ENTRIES.length);
          }}
        />
      </aside>
    );
  }

  return (
    <aside aria-label="Palette" className={`${PANEL} max-h-[calc(100%-72px)] w-[176px] overflow-hidden`}>
      {/* The heading sits on the same 16 px text edge as the items below it. */}
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-line pl-4 pr-1">
        <h2 id={headingId} className="min-w-0 flex-1 truncate font-condensed text-[13px] font-semibold text-ink">
          Add
        </h2>
        <IconButton
          size="sm"
          label="Collapse the palette"
          icon={<ChevronsLeft size={15} />}
          onClick={() => setOpen(false)}
        />
      </header>

      <div
        role="toolbar"
        aria-orientation="vertical"
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        <div role="group" aria-labelledby={cardsId}>
          <Caption id={cardsId}>Cards</Caption>
          <div className="flex flex-col gap-1">
            {CARD_ENTRIES.map((entry, index) => (
              <Item
                key={entry.label}
                entry={entry}
                index={index}
                layout="row"
                tabbable={index === activeIndex}
                onFocusItem={setActive}
                onPick={pick}
                register={register}
              />
            ))}
          </div>
        </div>

        <hr className="my-2 border-line" />

        <div role="group" aria-labelledby={shapesId}>
          <Caption id={shapesId}>Shapes</Caption>
          <div className="grid grid-cols-4 gap-1">
            {SHAPE_ENTRIES.map((entry, offset) => {
              const index = CARD_ENTRIES.length + offset;
              return (
                <Item
                  key={entry.label}
                  entry={entry}
                  index={index}
                  layout="cell"
                  tabbable={index === activeIndex}
                  onFocusItem={setActive}
                  onPick={pick}
                  register={register}
                />
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

function Caption({ id, children }: { id?: string; children: string }): JSX.Element {
  return (
    <p id={id} className="px-2 pb-1 text-[11px] leading-none text-ink-muted">
      {children}
    </p>
  );
}

/**
 * The same list, as a menu.
 *
 * Two other places ask the question this panel asks — the toolbar's add button,
 * and the menu that opens where an arrow is let go on empty canvas — and three
 * renderings of one list is three chances for them to drift apart. They get
 * this, so the card in all three is the same card, at the same size, under the
 * same pointer.
 *
 * The panel itself does not use it: an item there is draggable and sits in a
 * roving tab stop, neither of which a menu item is.
 */
export function PaletteMenuItems({ onPick }: { onPick(entry: PaletteEntry): void }): JSX.Element {
  return (
    <>
      <Caption>Cards</Caption>
      <div className="flex flex-col gap-1">
        {CARD_ENTRIES.map((entry) => (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            title={entryTitle(entry)}
            aria-label={entryTitle(entry)}
            onClick={() => onPick(entry)}
            className={paletteItemClass('row')}
          >
            <PaletteItemFace entry={entry} layout="row" />
          </button>
        ))}
      </div>

      <hr className="my-2 border-line" />

      <Caption>Shapes</Caption>
      <div className="grid grid-cols-4 gap-1">
        {SHAPE_ENTRIES.map((entry) => (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            title={entryTitle(entry)}
            aria-label={entryTitle(entry)}
            onClick={() => onPick(entry)}
            className={paletteItemClass('cell')}
          >
            <PaletteItemFace entry={entry} layout="cell" />
          </button>
        ))}
      </div>
    </>
  );
}

function Divider(): JSX.Element {
  return <span className="h-px w-6 shrink-0 bg-[var(--line)]" aria-hidden />;
}
