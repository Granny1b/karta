import { create } from 'zustand';
import type { Id } from '@/domain/board';
import { newId } from '@/lib/ids';
import { readLocal, writeLocal } from '@/lib/storage';

export type ViewMode = 'canvas' | 'kanban';
export type DialogName =
  | 'import'
  | 'export'
  | 'snapshots'
  | 'search'
  | 'shortcuts'
  | 'labels'
  | 'statuses';
export type Theme = 'light' | 'dark';
export type ToastKind = 'info' | 'warn' | 'error';

export interface Filter {
  text: string;
  labelIds: Id[];
  statusIds: Id[];
  hasDue: boolean;
  hasOpenChecklist: boolean;
}

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

export const EMPTY_FILTER: Filter = {
  text: '',
  labelIds: [],
  statusIds: [],
  hasDue: false,
  hasOpenChecklist: false,
};

/* Local preferences (spec 7.4: the view toggle is remembered per board). */

const KEY_THEME = 'karta:theme';
const KEY_SIDEBAR = 'karta:sidebar';
const KEY_VIEW = 'karta:view';
const viewKey = (boardId: Id): string => `view:${boardId}`;

function initialTheme(): Theme {
  const stored = readLocal(KEY_THEME);
  if (stored === 'light' || stored === 'dark') return stored;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function initialView(): ViewMode {
  return readLocal(KEY_VIEW) === 'kanban' ? 'kanban' : 'canvas';
}

const TOAST_MS: Record<ToastKind, number> = { info: 3500, warn: 6000, error: 9000 };
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface UiState {
  view: ViewMode;
  viewBoardId: Id | null;
  setView(v: ViewMode): void;
  toggleView(): void;
  setViewForBoard(boardId: Id, view: ViewMode): void;
  loadViewForBoard(boardId: Id): void;

  sidebarOpen: boolean;
  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;

  editorNodeId: Id | null;
  openEditor(id: Id | null): void;

  dialog: DialogName | null;
  setDialog(d: DialogName | null): void;

  theme: Theme;
  toggleTheme(): void;

  filter: Filter;
  setFilter(patch: Partial<Filter>): void;
  clearFilter(): void;
  filterActive(): boolean;

  toasts: Toast[];
  toast(message: string, kind?: ToastKind): void;
  dismissToast(id: string): void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  view: initialView(),
  viewBoardId: null,

  setView(v) {
    const { viewBoardId } = get();
    set({ view: v });
    writeLocal(KEY_VIEW, v);
    if (viewBoardId) writeLocal(viewKey(viewBoardId), v);
  },

  toggleView() {
    get().setView(get().view === 'canvas' ? 'kanban' : 'canvas');
  },

  setViewForBoard(boardId, view) {
    set({ view, viewBoardId: boardId });
    writeLocal(KEY_VIEW, view);
    writeLocal(viewKey(boardId), view);
  },

  loadViewForBoard(boardId) {
    const stored = readLocal(viewKey(boardId));
    const view: ViewMode = stored === 'kanban' || stored === 'canvas' ? stored : initialView();
    set({ view, viewBoardId: boardId });
  },

  sidebarOpen: readLocal(KEY_SIDEBAR) === 'open',
  toggleSidebar() {
    get().setSidebarOpen(!get().sidebarOpen);
  },
  setSidebarOpen(open) {
    set({ sidebarOpen: open });
    writeLocal(KEY_SIDEBAR, open ? 'open' : 'closed');
  },

  editorNodeId: null,
  openEditor(id) {
    set({ editorNodeId: id });
  },

  dialog: null,
  setDialog(d) {
    set({ dialog: d });
  },

  theme: initialTheme(),
  toggleTheme() {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme });
    writeLocal(KEY_THEME, theme);
    applyTheme(theme);
  },

  filter: EMPTY_FILTER,
  setFilter(patch) {
    set({ filter: { ...get().filter, ...patch } });
  },
  clearFilter() {
    set({ filter: EMPTY_FILTER });
  },
  filterActive() {
    const f = get().filter;
    return (
      f.text.trim().length > 0 ||
      f.labelIds.length > 0 ||
      f.statusIds.length > 0 ||
      f.hasDue ||
      f.hasOpenChecklist
    );
  },

  toasts: [],
  toast(message, kind = 'info') {
    const id = newId();
    set({ toasts: [...get().toasts, { id, message, kind }] });
    const timer = setTimeout(() => get().dismissToast(id), TOAST_MS[kind]);
    toastTimers.set(id, timer);
  },
  dismissToast(id) {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

// The stored theme has to reach the document before the first paint of the app.
applyTheme(useUiStore.getState().theme);
