import { useEffect, useRef, useState } from 'react';
import { Search,
  Columns3,
  Download,
  History,
  Keyboard,
  LogOut,
  Map as MapIcon,
  Moon,
  PanelLeft,
  SlidersHorizontal,
  Sun,
  Upload,
} from 'lucide-react';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import FilterBar from '@/kanban/FilterBar';
import Breadcrumb from '@/board/Breadcrumb';
import IconButton from '@/components/IconButton';

/** Apple keyboards send Meta for this binding, so the hint has to match. */
const SEARCH_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '\u2318K'
    : 'Ctrl K';
import Tooltip from '@/components/Tooltip';

/**
 * The one bar (spec 8.3): breadcrumb left, view toggle and filter centre, save
 * state and identity right. 48 px, one hairline, nothing else.
 */
export default function TopBar(): JSX.Element {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const setDialog = useUiStore((s) => s.setDialog);

  return (
    <header className="flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-line bg-raised px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <IconButton
          label={sidebarOpen ? 'Hide the board list' : 'Show the board list'}
          icon={<PanelLeft size={17} />}
          active={sidebarOpen}
          onClick={toggleSidebar}
        />
        <Breadcrumb />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ViewToggle />
        <FilterControl />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <SaveState />
        <SearchBar onOpen={() => setDialog('search')} />
        <IconButton label="Import JSON" icon={<Upload size={17} />} onClick={() => setDialog('import')} />
        <IconButton label="Export JSON" icon={<Download size={17} />} onClick={() => setDialog('export')} />
        <IconButton
          label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
          icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          onClick={toggleTheme}
        />
        <AccountMenu />
      </div>
    </header>
  );
}

/**
 * The search box in the ribbon.
 *
 * `Ctrl+K` has existed since the first build and had no visible affordance, so
 * it went unfound — a control that exists only as a keystroke is a control most
 * people do not have. This shows the shortcut rather than hiding it in a
 * tooltip.
 *
 * It looks like a field but is a button: typing happens in the dialog it opens,
 * so there is one search input rather than two that have to agree.
 */
function SearchBar({ onOpen }: { onOpen(): void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Search this board and every board title"
      className="group flex h-7 w-[168px] shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-line bg-canvas px-2 text-left text-ink-muted transition-colors duration-[var(--dur-fast)] ease-linear hover:border-line-strong hover:text-ink"
    >
      <Search size={14} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13px]">Search</span>
      <kbd className="shrink-0 rounded border border-line px-1 font-mono text-[10px] leading-[15px] text-ink-muted">
        {SEARCH_KEY}
      </kbd>
    </button>
  );
}

function ViewToggle(): JSX.Element {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  const item = (active: boolean): string =>
    `flex h-7 items-center gap-1.5 px-2 text-[13px] ${active ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink'}`;

  return (
    <div
      role="group"
      aria-label="View"
      className="flex overflow-hidden rounded-[var(--radius)] border border-line"
    >
      <button type="button" aria-pressed={view === 'canvas'} onClick={() => setView('canvas')} className={item(view === 'canvas')}>
        <MapIcon size={14} />
        Canvas
      </button>
      <span className="w-px shrink-0 bg-[var(--line)]" aria-hidden />
      <button type="button" aria-pressed={view === 'kanban'} onClick={() => setView('kanban')} className={item(view === 'kanban')}>
        <Columns3 size={14} />
        Columns
      </button>
    </div>
  );
}

/**
 * The filter lives in the bar on the canvas, where there is nowhere else to put
 * it. The kanban carries the same `FilterBar` inline above its columns, so the
 * button would only be a second door into the same room.
 */
function FilterControl(): JSX.Element | null {
  const view = useUiStore((s) => s.view);
  const filter = useUiStore((s) => s.filter);
  const active = useUiStore((s) => s.filterActive());
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (view !== 'canvas') return null;

  const count =
    filter.labelIds.length +
    filter.statusIds.length +
    (filter.text.trim().length > 0 ? 1 : 0) +
    (filter.hasDue ? 1 : 0) +
    (filter.hasOpenChecklist ? 1 : 0);

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-7 items-center gap-1.5 rounded-[var(--radius)] border px-2 text-[13px] ${
          active ? 'border-line-strong text-ink' : 'border-line text-ink-muted hover:text-ink'
        }`}
      >
        <SlidersHorizontal size={14} />
        Filter
        {count > 0 ? ` (${count})` : ''}
      </button>

      {open ? (
        <div className="absolute left-1/2 top-full z-40 mt-1 w-[520px] max-w-[92vw] -translate-x-1/2 rounded-[var(--radius)] border border-line bg-raised p-2">
          <FilterBar />
          <p className="mt-2 px-0.5 text-[12px] text-ink-muted">
            On the canvas, cards that do not match are dimmed rather than hidden.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One word (spec 8.3). `Conflict` is a label, not a button: the conflict dialog
 * is already in front of everything and cannot be dismissed without answering it.
 */
function SaveState(): JSX.Element | null {
  const saveState = useBoardStore((s) => s.saveState);
  const dirty = useBoardStore((s) => s.dirty);
  const loading = useBoardStore((s) => s.loading);
  const doc = useBoardStore((s) => s.doc);

  if (loading || !doc) return null;

  let word: string;
  let tone = 'text-ink-muted';
  let explanation = '';

  if (saveState === 'conflict') {
    word = 'Conflict';
    tone = 'text-[var(--temper-copper)]';
    explanation = 'This board changed somewhere else.';
  } else if (saveState === 'saving') {
    word = 'Saving…';
  } else if (saveState === 'offline') {
    word = 'Offline';
    tone = 'text-[var(--temper-straw)]';
    explanation = 'No connection. Your work is kept on this device and saved when the connection is back.';
  } else if (dirty) {
    word = 'Unsaved';
    explanation = 'There are changes here that have not reached the server yet.';
  } else {
    word = 'Saved';
  }

  const label = (
    <span className={`px-2 text-[13px] ${tone}`} aria-live="polite">
      {word}
    </span>
  );

  return explanation.length > 0 ? <Tooltip label={explanation}>{label}</Tooltip> : label;
}

function initialsFor(name: string): string {
  const cleaned = name.replace(/@.*$/, '').replace(/[._-]+/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

function AccountMenu(): JSX.Element {
  const me = useBoardStore((s) => s.me);
  // Restore points are a board's own history, so the item is only live once a
  // board is open — a dialog that cannot render must never be asked for, or
  // `ui.dialog` is left set with nothing on screen to clear it.
  const doc = useBoardStore((s) => s.doc);
  const setDialog = useUiStore((s) => s.setDialog);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const name = me?.userDetails ?? '';
  const item =
    'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] text-ink hover:bg-sunken disabled:text-ink-muted disabled:hover:bg-transparent';

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={name ? `Account: ${name}` : 'Account'}
        title={name || 'Account'}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-sunken text-[11px] font-semibold text-ink-muted hover:text-ink"
      >
        {initialsFor(name)}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-[var(--radius)] border border-line bg-raised py-1">
          {name ? <p className="truncate px-2 pb-1 text-[12px] text-ink-muted">{name}</p> : null}
          <button
            type="button"
            className={item}
            disabled={!doc}
            title={doc ? undefined : 'Open a board first'}
            onClick={() => {
              setOpen(false);
              setDialog('snapshots');
            }}
          >
            <History size={14} />
            Restore points
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              setDialog('shortcuts');
            }}
          >
            <Keyboard size={14} />
            Keyboard shortcuts
          </button>
          <a className={item} href="/.auth/logout?post_logout_redirect_uri=/">
            <LogOut size={14} />
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}
