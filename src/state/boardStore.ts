import { produce } from 'immer';
import { create } from 'zustand';
import {
  SIZE_HARD_STOP_BYTES,
  SIZE_WARN_BYTES,
  SIZE_WARN_NODES,
  type BoardDoc,
  type BoardIndex,
  type BoardNode,
  type Edge,
  type Id,
  type Iso,
  type MediaRef,
  type Me,
  type Viewport,
} from '@/domain/board';
import { ApiError, api } from '@/lib/api';
import { formatBytes, nowIso } from '@/lib/format';
import { readLocal, writeLocal } from '@/lib/storage';
import { mergeBoards } from '@/state/merge';
import { clearWal, readWal, walHoldsUnsavedWork, writeWal } from '@/state/wal';
import { useUiStore, type ToastKind } from '@/state/uiStore';

/* ------------------------------------------------------------------ *
 * Tuning — every number here comes from the spec.
 * ------------------------------------------------------------------ */

const IDLE_MS = 1_500; // autosave after this much quiet (spec 6.1)
const MAX_WAIT_MS = 10_000; // ...or this long after the last successful save
const VIEWPORT_MS = 5_000; // camera is persisted separately (spec 6.1)
const POLL_MS = 20_000; // index poll while a board is open (spec 6.4)
const UNDO_LIMIT = 200; // in memory only (spec 7.1)
const MAX_MERGE_RETRIES = 3; // then the conflict dialog (spec 6.4)

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict';

export interface UndoEntry {
  label: string;
  doc: BoardDoc;
}

export interface WalRecovery {
  doc: BoardDoc;
  savedAt: Iso;
}

export interface BoardState {
  boardId: Id | null;
  doc: BoardDoc | null;
  /** The document as the server last confirmed it — the base for a three-way merge. */
  base: BoardDoc | null;
  etag: string | null;
  index: BoardIndex | null;
  me: Me | null;

  saveState: SaveState;
  dirty: boolean;
  error: string | null;
  loading: boolean;
  pendingOrphans: string[];

  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  /** Unsaved work found in IndexedDB that is newer than the server's copy. */
  walRecovery: WalRecovery | null;
  /** The index says this board moved elsewhere while we hold unsaved changes. */
  newerAvailable: boolean;

  loadMe(): Promise<void>;
  loadIndex(): Promise<void>;
  loadBoard(id: Id): Promise<void>;
  save(force?: boolean): Promise<void>;

  mutate(label: string, recipe: (d: BoardDoc) => void): void;
  mutateSilent(recipe: (d: BoardDoc) => void): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  addNode(node: BoardNode): void;
  updateNode(id: Id, patch: Record<string, unknown>, label?: string): void;
  removeNodes(ids: Id[]): void;
  addEdgeToBoard(edge: Edge): void;
  updateEdge(id: Id, patch: Partial<Edge>): void;
  removeEdges(ids: Id[]): void;
  setViewport(v: Viewport): void;
  addMedia(ref: MediaRef): void;
  replaceDoc(doc: BoardDoc, etag: string, label: string): void;

  acceptWalRecovery(): void;
  discardWalRecovery(): void;
}

/* ------------------------------------------------------------------ *
 * Module-local scheduling state. Timers are not rendered, so they stay
 * out of the store.
 * ------------------------------------------------------------------ */

type Timer = ReturnType<typeof setTimeout>;

let idleTimer: Timer | null = null;
let maxTimer: Timer | null = null;
let viewportTimer: Timer | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

let lastSaveAt = 0;

/**
 * One `PUT` at a time. A board save and a camera write share the ETag held since
 * load, so they must never overlap: a board save waits here, a camera write gives
 * up and re-arms its own timer — it is fire-and-forget by design (spec 6.1).
 */
let inFlight: Promise<void> | null = null;

/**
 * Board saves run one after another on this chain, so `await save()` means
 * "everything mutated before the call has been written" (spec 6.1).
 */
let saveChain: Promise<void> = Promise.resolve();

/**
 * Bumped by every change that dirties the document. A save compares it across
 * the round trip to tell real work from a camera move or a board-link rollup,
 * both of which change the document object without dirtying the board.
 */
let mutationSeq = 0;

/** Boards already warned about size, so the toast fires once per session. */
const sizeWarned = new Set<Id>();
let hardStoppedBoard: Id | null = null;
/** Boards the server has refused as invalid, so that toast fires once too. */
let rejectedBoard: Id | null = null;

function toast(message: string, kind: ToastKind = 'info'): void {
  useUiStore.getState().toast(message, kind);
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function byteLength(json: string): number {
  return new TextEncoder().encode(json).length;
}

function describe(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** The first field the API named as invalid, e.g. `doc.nodes[3].label: ...`. */
function firstDetail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const details = (body as { details?: unknown }).details;
  if (!Array.isArray(details)) return null;
  const first = details.find((d): d is string => typeof d === 'string' && d.trim().length > 0);
  return first === undefined ? null : first.trim().slice(0, 160);
}

/**
 * A 400 is not a hiccup to retry: the document as it stands will be refused by
 * every save that follows it, so the message has to name the field at fault
 * and the one move that gets out of it. "Could not save this board", repeated
 * on a timer with nothing to act on, is how a board ends up silently unsaved.
 */
function rejectedMessage(err: ApiError): string {
  const detail = firstDetail(err.body);
  const escape = 'Undo that change (Ctrl+Z) and save again.';
  return detail === null
    ? `The server refused this board. ${escape}`
    : `The server refused this board — ${detail}. ${escape}`;
}

/* ------------------------------------------------------------------ *
 * Autosave scheduling (spec 6.1)
 * ------------------------------------------------------------------ */

function clearAutosaveTimers(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (maxTimer) clearTimeout(maxTimer);
  idleTimer = null;
  maxTimer = null;
}

/**
 * The timers are cleared by the save itself, once it knows it is going to run.
 * Disarming them here would leave nothing armed whenever the save has to wait.
 */
function runAutosave(): void {
  void useBoardStore.getState().save();
}

/** Fires on 1.5 s of quiet, or 10 s after the last successful save — first one wins. */
function scheduleAutosave(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(runAutosave, IDLE_MS);
  if (maxTimer === null) {
    const elapsed = Date.now() - lastSaveAt;
    maxTimer = setTimeout(runAutosave, Math.max(0, MAX_WAIT_MS - elapsed));
  }
}

function scheduleViewportSave(): void {
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => {
    viewportTimer = null;
    void saveViewport();
  }, VIEWPORT_MS);
}

/**
 * Serialises the two writers. Board saves wait their turn; the camera does not
 * queue, so `saveViewport` checks `inFlight` itself and re-arms its timer.
 */
async function holdPut<T>(body: () => Promise<T>): Promise<T> {
  while (inFlight) await inFlight;

  let release: () => void = () => {};
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  inFlight = lock;

  try {
    return await body();
  } finally {
    if (inFlight === lock) inFlight = null;
    release();
  }
}

/**
 * The camera is written with the ETag we happen to hold and nothing is retried:
 * last one wins, and a lost camera position is not worth a dialog (spec 6.1).
 */
async function saveViewport(): Promise<void> {
  const state = useBoardStore.getState();
  const { boardId, doc } = state;
  if (!boardId || !doc) return;
  if (state.dirty) {
    scheduleAutosave(); // a real save is pending; it carries the viewport
    return;
  }
  if (state.walRecovery) return;
  if (inFlight) {
    // A save holds the wire and it was addressed before this camera move, so it
    // may not carry it. Try again on the next debounce rather than dropping the
    // position — a camera write never joins the save queue.
    scheduleViewportSave();
    return;
  }

  await holdPut(async () => {
    try {
      const result = await api.putBoard(boardId, doc, state.etag, []);
      const latest = useBoardStore.getState();
      // A restore or an import can land mid-flight; its ETag is the live one.
      if (latest.boardId !== boardId || latest.etag !== state.etag) return;

      // `updatedAt` is stamped server-side on every PUT, so the server's echo is
      // the only honest baseline. Keeping a client-stamped one would leave the
      // index ahead of `base`, and the 20 s poll of spec 6.4 would read our own
      // camera write as somebody else's change and reload over the session.
      const nextDoc =
        latest.doc === doc
          ? result.doc
          : produce(latest.doc ?? doc, (d) => {
              d.updatedAt = result.doc.updatedAt;
            });
      useBoardStore.setState({ doc: nextDoc, base: clone(result.doc), etag: result.etag });
      lastSaveAt = Date.now();
    } catch {
      /* exempt from conflict handling by design (spec 6.1) */
    }
  });
}

/* ------------------------------------------------------------------ *
 * Size budget (spec 5.6)
 * ------------------------------------------------------------------ */

function checkSize(doc: BoardDoc): { ok: true } | { ok: false; message: string } {
  const bytes = byteLength(JSON.stringify(doc));
  const nodes = doc.nodes.length;

  if (bytes > SIZE_HARD_STOP_BYTES) {
    return {
      ok: false,
      message:
        `This board is ${formatBytes(bytes)} and too large to save. ` +
        'Select part of it and use Extract to board (Ctrl+Shift+B) to move it into a nested board, then save again.',
    };
  }

  if ((nodes > SIZE_WARN_NODES || bytes > SIZE_WARN_BYTES) && !sizeWarned.has(doc.id)) {
    sizeWarned.add(doc.id);
    toast(
      `This board is getting big — ${nodes} nodes, ${formatBytes(bytes)}. Consider moving part of it into a nested board.`,
      'warn',
    );
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Index polling and board-link rollups (spec 5.2, 6.4)
 * ------------------------------------------------------------------ */

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling(boardId: Id): void {
  stopPolling();
  pollTimer = setInterval(() => void poll(boardId), POLL_MS);
}

function refreshBoardLinks(index: BoardIndex): void {
  const { doc } = useBoardStore.getState();
  if (!doc) return;

  const summaries = new Map(index.boards.map((b) => [b.id, b]));
  const stale = doc.nodes.some((node) => {
    if (node.kind !== 'boardLink') return false;
    const summary = summaries.get(node.targetBoardId);
    if (!summary) return false;
    return (
      node.cachedTitle !== summary.title ||
      node.cachedCounts?.total !== summary.counts.cards ||
      node.cachedCounts?.done !== summary.counts.done
    );
  });
  if (!stale) return;

  // Rollups are derived from the index, so refreshing them is not user work:
  // no undo entry, no dirty flag, no save.
  useBoardStore.getState().mutateSilent((d) => {
    for (const node of d.nodes) {
      if (node.kind !== 'boardLink') continue;
      const summary = summaries.get(node.targetBoardId);
      if (!summary) continue;
      node.cachedTitle = summary.title;
      node.cachedCounts = { total: summary.counts.cards, done: summary.counts.done };
    }
  });
}

async function reloadSilently(boardId: Id): Promise<void> {
  const { doc: fresh, etag } = await api.getBoard(boardId);
  const state = useBoardStore.getState();
  if (state.boardId !== boardId || state.dirty || !state.doc) return;

  // Keep the local camera; the server's viewport is whatever the other client
  // was looking at and moving the user's view would be rude.
  const doc = produce(fresh, (d) => {
    d.viewport = { ...state.doc!.viewport };
  });
  useBoardStore.setState({
    doc,
    base: clone(fresh),
    etag,
    newerAvailable: false,
    undoStack: [],
    redoStack: [],
  });
}

async function poll(boardId: Id): Promise<void> {
  const state = useBoardStore.getState();
  if (state.boardId !== boardId) {
    stopPolling();
    return;
  }
  if (!state.doc || state.loading || inFlight) return;

  try {
    const index = await api.getIndex();
    if (useBoardStore.getState().boardId !== boardId) return;
    useBoardStore.setState({ index });
    refreshBoardLinks(index);

    const summary = index.boards.find((b) => b.id === boardId);
    if (!summary) return;

    const current = useBoardStore.getState();
    const known = current.base?.updatedAt ?? current.doc?.updatedAt ?? '';
    if (summary.updatedAt <= known) return;

    if (current.dirty) useBoardStore.setState({ newerAvailable: true });
    else await reloadSilently(boardId);
  } catch {
    /* polling is opportunistic; a failed poll is not an error the user needs */
  }
}

/* ------------------------------------------------------------------ *
 * Daily snapshot (spec 7.5)
 * ------------------------------------------------------------------ */

async function maybeDailySnapshot(boardId: Id): Promise<void> {
  const key = `karta:snapshot:${boardId}`;
  const today = nowIso().slice(0, 10);
  if (readLocal(key) === today) return;
  try {
    await api.snapshot(boardId);
    writeLocal(key, today);
  } catch {
    /* a missing restore point is not worth interrupting the session */
  }
}

/* ------------------------------------------------------------------ *
 * Conflict path (spec 6.4)
 * ------------------------------------------------------------------ */

async function mergeFromServer(boardId: Id): Promise<boolean> {
  const server = await api.getBoard(boardId);
  const state = useBoardStore.getState();
  if (state.boardId !== boardId || !state.doc) return false;

  const { doc, notes } = mergeBoards(state.base ?? server.doc, state.doc, server.doc);
  const merged = produce(doc, (d) => {
    d.updatedAt = nowIso();
  });

  mutationSeq += 1;
  useBoardStore.setState({
    doc: merged,
    base: clone(server.doc),
    etag: server.etag,
    newerAvailable: false,
    dirty: true,
  });
  void writeWal(boardId, merged, server.etag);
  for (const note of notes) toast(note, 'warn');
  return true;
}

/* ------------------------------------------------------------------ *
 * The save pipeline (spec 6.1)
 * ------------------------------------------------------------------ */

/**
 * One turn of the pipeline. It runs on `saveChain`, so it never overlaps another
 * save, and it re-reads the store on entry: a save queued behind another one and
 * left with nothing to do collapses into a no-op instead of a second write.
 */
async function runSave(force: boolean): Promise<void> {
  // Now that this save is going to run, the timers that asked for it are spent.
  clearAutosaveTimers();

  const start = useBoardStore.getState();
  const boardId = start.boardId;
  if (!boardId || !start.doc) return;
  if (!start.dirty && !force) return;

  useBoardStore.setState({ saveState: 'saving', error: null });

  try {
    await holdPut(async () => {
      let attempt = 0;
      for (;;) {
        const current = useBoardStore.getState();
        const doc = current.doc;
        if (!doc || current.boardId !== boardId) return;

        const size = checkSize(doc);
        if (!size.ok) {
          useBoardStore.setState({ error: size.message, saveState: 'idle' });
          if (hardStoppedBoard !== boardId) {
            hardStoppedBoard = boardId;
            toast(size.message, 'error');
          }
          return;
        }

        const orphans = current.pendingOrphans;
        const sentEtag = current.etag;
        const seqAtSend = mutationSeq;

        try {
          const result = await api.putBoard(boardId, doc, sentEtag, orphans);
          const latest = useBoardStore.getState();
          // A restore or an import can land while the PUT is in flight. Its ETag
          // is the live one and the one we just earned is already two versions
          // stale, so installing it would 412 the next save.
          if (latest.boardId !== boardId || latest.etag !== sentEtag) {
            useBoardStore.setState({ saveState: 'idle' });
            return;
          }

          const untouched = latest.doc === doc; // did the document object change at all?
          const edited = mutationSeq !== seqAtSend; // ...and was any of that user work?
          lastSaveAt = Date.now();
          hardStoppedBoard = null;
          rejectedBoard = null;
          useBoardStore.setState({
            // Keep the live document when it moved on: a camera move or a
            // board-link rollup landed on it and the server's echo predates them.
            doc: untouched ? result.doc : latest.doc,
            base: clone(result.doc),
            etag: result.etag,
            dirty: edited,
            saveState: edited ? 'idle' : 'saved',
            error: null,
            newerAvailable: false,
            pendingOrphans: latest.pendingOrphans.filter((path) => !orphans.includes(path)),
          });

          if (edited) scheduleAutosave();
          else void clearWal(boardId);
          return;
        } catch (err) {
          if (err instanceof ApiError && err.conflict && attempt < MAX_MERGE_RETRIES) {
            attempt += 1;
            if (!(await mergeFromServer(boardId))) return;
            continue;
          }
          throw err;
        }
      }
    });
  } catch (err) {
    if (useBoardStore.getState().boardId !== boardId) return;
    if (err instanceof ApiError && err.offline) {
      // The write-ahead entry stays; the next mutation reschedules the save.
      useBoardStore.setState({ saveState: 'offline', error: null });
    } else if (err instanceof ApiError && err.conflict) {
      useBoardStore.setState({ saveState: 'conflict', error: 'This board changed somewhere else.' });
    } else if (err instanceof ApiError && err.status === 400) {
      // The document itself is the problem, so every autosave after this one
      // repeats it verbatim. Say what is wrong once, and keep saying it in the
      // status line rather than in a toast per attempt.
      const message = rejectedMessage(err);
      useBoardStore.setState({ saveState: 'idle', error: message });
      if (rejectedBoard !== boardId) {
        rejectedBoard = boardId;
        toast(message, 'error');
      }
    } else {
      const message = describe(err, 'Could not save this board');
      useBoardStore.setState({ saveState: 'idle', error: message });
      toast(message, 'error');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export const useBoardStore = create<BoardState>()((set, get) => ({
  boardId: null,
  doc: null,
  base: null,
  etag: null,
  index: null,
  me: null,

  saveState: 'idle',
  dirty: false,
  error: null,
  loading: false,
  pendingOrphans: [],

  undoStack: [],
  redoStack: [],
  walRecovery: null,
  newerAvailable: false,

  async loadMe() {
    try {
      set({ me: await api.me() });
    } catch (err) {
      if (err instanceof ApiError && err.offline) set({ saveState: 'offline' });
    }
  },

  async loadIndex() {
    try {
      const index = await api.getIndex();
      set({ index, error: null });
      refreshBoardLinks(index);
      if (!get().me) void get().loadMe();
    } catch (err) {
      set({ error: describe(err, 'Could not load the board list') });
      if (err instanceof ApiError && err.offline) set({ saveState: 'offline' });
    }
  },

  async loadBoard(id) {
    clearAutosaveTimers();
    stopPolling();
    hardStoppedBoard = null;
    rejectedBoard = null;

    set({
      boardId: id,
      doc: null,
      base: null,
      etag: null,
      loading: true,
      error: null,
      dirty: false,
      saveState: 'idle',
      pendingOrphans: [],
      undoStack: [],
      redoStack: [],
      walRecovery: null,
      newerAvailable: false,
    });

    try {
      const { doc, etag } = await api.getBoard(id);
      if (get().boardId !== id) return;

      lastSaveAt = Date.now();
      set({ doc, base: clone(doc), etag, loading: false, saveState: 'idle' });

      const wal = await readWal(id);
      if (get().boardId !== id) return;
      if (wal) {
        // Never judged on a timestamp: this browser stamps `updatedAt` from its
        // own clock and the server restamps it on every PUT, so the two are not
        // comparable. The entry is dropped only once its work is provably on the
        // server (spec 7.5.3); anything else is offered back to the user.
        if (walHoldsUnsavedWork(wal, { doc, etag })) {
          set({ walRecovery: { doc: wal.doc, savedAt: wal.savedAt } });
        } else {
          await clearWal(id);
        }
      }

      if (!get().me) void get().loadMe();
      startPolling(id);
      void maybeDailySnapshot(id);
    } catch (err) {
      if (get().boardId !== id) return;
      const offline = err instanceof ApiError && err.offline;
      set({
        loading: false,
        error: describe(err, 'Could not open this board'),
        saveState: offline ? 'offline' : 'idle',
      });
    }
  },

  /**
   * Takes its turn behind whatever is already saving, so `await save()` is a
   * flush barrier: when it resolves, everything mutated before the call has been
   * written (or has failed loudly into `saveState`). A rejected save must not
   * poison the queue for the next caller.
   */
  async save(force = false) {
    const run = saveChain.then(() => runSave(force));
    saveChain = run.catch(() => {});
    await run;
  },

  mutate(label, recipe) {
    const state = get();
    const current = state.doc;
    const boardId = state.boardId;
    if (!current || !boardId) return;

    const next = produce(current, recipe);
    if (next === current) return; // a recipe that changed nothing is not an edit

    const previousNodes = new Map(current.nodes.map((n) => [n.id, n]));
    const previousEdges = new Map(current.edges.map((e) => [e.id, e]));
    const touchedNodes = new Set<Id>();
    const touchedEdges = new Set<Id>();
    for (const node of next.nodes) if (previousNodes.get(node.id) !== node) touchedNodes.add(node.id);
    for (const edge of next.edges) if (previousEdges.get(edge.id) !== edge) touchedEdges.add(edge.id);

    const stamp = nowIso();
    const user = state.me?.userId ?? '';
    const stamped = produce(next, (d) => {
      d.updatedAt = stamp;
      for (const node of d.nodes) {
        if (!touchedNodes.has(node.id)) continue;
        node.updatedAt = stamp;
        node.updatedBy = user;
      }
      for (const edge of d.edges) {
        if (touchedEdges.has(edge.id)) edge.updatedAt = stamp;
      }
    });

    mutationSeq += 1;
    set({
      doc: stamped,
      dirty: true,
      undoStack: [...state.undoStack, { label, doc: current }].slice(-UNDO_LIMIT),
      redoStack: [],
      saveState: state.saveState === 'saved' ? 'idle' : state.saveState,
    });
    void writeWal(boardId, stamped, state.etag);
    scheduleAutosave();
  },

  mutateSilent(recipe) {
    const current = get().doc;
    if (!current) return;
    const next = produce(current, recipe);
    if (next !== current) set({ doc: next });
  },

  undo() {
    const { undoStack, redoStack, doc, boardId, etag } = get();
    const entry = undoStack[undoStack.length - 1];
    if (!entry || !doc || !boardId) return;

    const restored = produce(entry.doc, (d) => {
      d.updatedAt = nowIso();
    });
    mutationSeq += 1;
    set({
      doc: restored,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, { label: entry.label, doc }].slice(-UNDO_LIMIT),
      dirty: true,
      saveState: get().saveState === 'saved' ? 'idle' : get().saveState,
    });
    void writeWal(boardId, restored, etag);
    scheduleAutosave();
  },

  redo() {
    const { undoStack, redoStack, doc, boardId, etag } = get();
    const entry = redoStack[redoStack.length - 1];
    if (!entry || !doc || !boardId) return;

    const restored = produce(entry.doc, (d) => {
      d.updatedAt = nowIso();
    });
    mutationSeq += 1;
    set({
      doc: restored,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, { label: entry.label, doc }].slice(-UNDO_LIMIT),
      dirty: true,
      saveState: get().saveState === 'saved' ? 'idle' : get().saveState,
    });
    void writeWal(boardId, restored, etag);
    scheduleAutosave();
  },

  canUndo() {
    return get().undoStack.length > 0;
  },

  canRedo() {
    return get().redoStack.length > 0;
  },

  addNode(node) {
    get().mutate(`Add ${node.kind === 'boardLink' ? 'board link' : node.kind}`, (d) => {
      if (!d.nodes.some((n) => n.id === node.id)) d.nodes.push(node);
    });
  },

  updateNode(id, patch, label) {
    get().mutate(label ?? 'Edit node', (d) => {
      const node = d.nodes.find((n) => n.id === id);
      if (!node) return;
      const target = node as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'id' || key === 'kind' || key === 'createdAt') continue;
        target[key] = value;
      }
    });
  },

  removeNodes(ids) {
    if (ids.length === 0) return;
    const doomed = new Set(ids);
    const orphans: string[] = [];

    get().mutate(ids.length === 1 ? 'Delete node' : `Delete ${ids.length} nodes`, (d) => {
      const removed = d.nodes.filter((n) => doomed.has(n.id));
      if (removed.length === 0) return;
      d.nodes = d.nodes.filter((n) => !doomed.has(n.id));
      d.edges = d.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target));

      // Media the deleted nodes carried, and that nothing left points at, is
      // deleted from blob storage on the next successful save (spec 5.5).
      // Refs the deletion did not touch are left alone: an upload can land
      // before its node exists, and a body can embed an image by path.
      const released = new Set<Id>();
      for (const node of removed) {
        if (node.kind === 'image') released.add(node.mediaId);
        if (node.kind === 'card' && node.coverMediaId) released.add(node.coverMediaId);
      }
      if (released.size > 0) {
        const text: string[] = [];
        for (const node of d.nodes) {
          if (node.kind === 'image') released.delete(node.mediaId);
          if (node.kind === 'card') {
            if (node.coverMediaId) released.delete(node.coverMediaId);
            text.push(node.body);
          }
          if (node.kind === 'note') text.push(node.text);
        }
        const prose = text.join('\n');
        const kept: MediaRef[] = [];
        for (const ref of d.media) {
          if (!released.has(ref.id) || prose.includes(ref.id)) kept.push(ref);
          else orphans.push(ref.blobPath, ref.thumbPath);
        }
        if (kept.length !== d.media.length) d.media = kept;
      }
    });

    if (orphans.length > 0) {
      const seen = new Set(get().pendingOrphans);
      const added = orphans.filter((path) => path.length > 0 && !seen.has(path));
      if (added.length > 0) set({ pendingOrphans: [...get().pendingOrphans, ...added] });
    }
  },

  addEdgeToBoard(edge) {
    get().mutate('Add arrow', (d) => {
      const exists = d.edges.some(
        (e) =>
          e.id === edge.id ||
          (e.source === edge.source &&
            e.target === edge.target &&
            e.sourceHandle === edge.sourceHandle &&
            e.targetHandle === edge.targetHandle),
      );
      const ids = new Set(d.nodes.map((n) => n.id));
      const connectable = edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target);
      if (!exists && connectable) d.edges.push(edge);
    });
  },

  updateEdge(id, patch) {
    get().mutate('Edit arrow', (d) => {
      const edge = d.edges.find((e) => e.id === id);
      if (!edge) return;
      Object.assign(edge, patch, { id: edge.id });
    });
  },

  removeEdges(ids) {
    if (ids.length === 0) return;
    const doomed = new Set(ids);
    get().mutate(ids.length === 1 ? 'Delete arrow' : `Delete ${ids.length} arrows`, (d) => {
      d.edges = d.edges.filter((e) => !doomed.has(e.id));
    });
  },

  setViewport(v) {
    const doc = get().doc;
    if (!doc) return;
    const { x, y, zoom } = doc.viewport;
    if (x === v.x && y === v.y && zoom === v.zoom) return;
    get().mutateSilent((d) => {
      d.viewport = { x: v.x, y: v.y, zoom: v.zoom };
    });
    scheduleViewportSave();
  },

  addMedia(ref) {
    get().mutate('Add image', (d) => {
      if (!d.media.some((m) => m.id === ref.id)) d.media.push(ref);
    });
  },

  /**
   * Wholesale document replacement — import, restore, or a resolved conflict.
   * A fresh ETag means the server already holds this document (restore), so it
   * lands clean; otherwise it is local work and saves like any other edit.
   */
  replaceDoc(doc, etag, label) {
    const state = get();
    const boardId = state.boardId ?? doc.id;
    const fromServer = etag !== state.etag;

    const next = fromServer
      ? doc
      : produce(doc, (d) => {
          d.updatedAt = nowIso();
        });

    if (!fromServer) mutationSeq += 1;
    set({
      boardId,
      doc: next,
      base: fromServer ? clone(doc) : state.base,
      etag,
      dirty: !fromServer,
      saveState: 'idle',
      error: null,
      newerAvailable: false,
      walRecovery: null,
      undoStack: state.doc ? [...state.undoStack, { label, doc: state.doc }].slice(-UNDO_LIMIT) : state.undoStack,
      redoStack: [],
    });

    if (fromServer) {
      lastSaveAt = Date.now();
      // Work that never reached the server is about to be buried by this
      // document. The write-ahead entry is the only copy left of it, so it stays
      // and the next load offers it back (spec 7.5.2); it is cleared only when
      // the board it replaces was clean.
      if (!state.dirty) void clearWal(boardId);
    } else {
      void writeWal(boardId, next, etag);
      scheduleAutosave();
    }
  },

  acceptWalRecovery() {
    const { walRecovery, boardId, etag } = get();
    if (!walRecovery || !boardId) return;
    mutationSeq += 1;
    set({
      doc: walRecovery.doc,
      walRecovery: null,
      dirty: true,
      saveState: 'idle',
      undoStack: [],
      redoStack: [],
    });
    // Re-anchor the entry to the version now on screen, so a second crash before
    // the save lands still recognises it as unsaved work.
    void writeWal(boardId, walRecovery.doc, etag);
    scheduleAutosave();
  },

  discardWalRecovery() {
    const { boardId } = get();
    set({ walRecovery: null });
    if (boardId) void clearWal(boardId);
  },
}));
