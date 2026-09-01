import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useKeyPress,
  useReactFlow,
  type Connection,
  useStore,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
  type ProOptions,
  type Viewport,
  type XYPosition,
} from '@xyflow/react';
import {
  type BoardNode,
  type CardNode,
  type ColorToken,
  type Handle as HandleSide,
  type Id,
} from '@/domain/board';
import { api } from '@/lib/api';
import { isEditableTarget } from '@/lib/keys';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { makeEdge } from '@/state/factories';
import { useCanvasImageDrop } from '@/media/paste';
import CanvasToolbar from '@/canvas/CanvasToolbar';
import ConnectMenu from '@/canvas/ConnectMenu';
import Palette from '@/canvas/Palette';
import SelectionMenu, {
  NO_SELECTION,
  SelectionAffordance,
  SelectionOpsContext,
  readSelectionFacts,
  type SelectionFacts,
  type SelectionOps,
} from '@/canvas/SelectionMenu';
import EmptyCanvasHint from '@/board/EmptyCanvasHint';
import { collectForClipboard, holdForClipboard, payloadForMarker } from '@/canvas/clipboard';
import { extractToBoard } from '@/canvas/extract';
import { isHandleSide, syncFlowEdges, syncFlowNodes } from '@/canvas/mapping';
import {
  hasEdgeBetween,
  CONNECT_DRAG_THRESHOLD,
  REFUSAL_TEXT,
  choiceSize,
  makeIsValidConnection,
  nodeRect,
  planDrop,
  rectCentre,
  resolveSides,
  type ConnectChoice,
  type Rect,
} from '@/canvas/connect';
import {
  NodeCreatedContext,
  createAt,
  paletteDragOver,
  paletteDrop,
  placementFor,
  type CreateLink,
} from '@/canvas/dragCreate';
import {
  boundsOfNodes,
  duplicateNodes,
  frameAround,
  nextCollapsed,
  nodesInsideFrame,
  offsetToCentre,
  pasteNodes,
} from '@/canvas/ops';
import { edgeTypes } from '@/canvas/edges';
import { nodeTypes } from '@/canvas/nodes';
import {
  draggedNode,
  neighboursOf,
  snapToNeighbours,
  type Rect as AlignRect,
} from '@/canvas/alignment';
import AlignmentGuides, { createGuideTracker } from '@/canvas/AlignmentGuides';
import { createSubBoardAt } from '@/canvas/createSubBoard';
import { planBoardDeletion, type DeletionPlan, type DoomedBoard } from '@/canvas/deleteBoards';
import DeleteBoardsDialog from '@/canvas/DeleteBoardsDialog';
import {
  describeSelection,
  useSelectionCounts,
  useSelectionTracker,
  withSelectionFlags,
} from '@/canvas/useSelection';
import { useCanvasShortcuts, type CanvasShortcutHandlers } from '@/canvas/useCanvasShortcuts';
import { SelectionScope } from '@/canvas/soleSelection';
import type { KartaFlowEdge, KartaFlowNode } from '@/canvas/types';
import '@xyflow/react/dist/style.css';
import '@/styles/canvas-chrome.css';
import './canvas.css';

/*
 * Every value React Flow reads on each render lives at module scope. An inline
 * array or object literal here takes a new identity on every render of the
 * surface, which breaks the shallow compare on React Flow's own memo
 * boundaries (`GraphView`, `FlowRenderer`) and re-arms the key listeners and
 * the pan/zoom filter — sixty times a second while a marquee is being dragged.
 */
const SNAP_GRID: [number, number] = [8, 8];

/**
 * Catch distances for alignment, in screen pixels — divided by the zoom before
 * use, so the snap feels the same however far in or out the camera is.
 *
 * A node joined to the dragged one by an arrow gets the wider figure: putting a
 * card back where its arrow runs straight is the gesture this exists for, and
 * the ordinary distance is too fine to find by hand.
 */
const ALIGN_REACH = 6;
const ALIGN_REACH_CONNECTED = 22;
/*
 * Middle button only. The right button used to pan as well, which cannot
 * coexist with a context menu: the browser fires `contextmenu` on the press on
 * some platforms and on the release on others, so a right-drag would either
 * open the menu before the pan or after it. Panning keeps three ways in — the
 * space bar, the middle button, and two-finger scroll — and the right button
 * now does what it does everywhere else, which is ask what goes here.
 */
const PAN_ON_DRAG: number[] = [1];
const MULTI_SELECT_KEYS: string[] = ['Shift', 'Meta', 'Control'];
const ZOOM_KEYS: string[] = ['Control', 'Meta'];
const PRO_OPTIONS: ProOptions = { hideAttribution: false };
const FIT_VIEW_OPTIONS = { padding: 0.2, duration: 200, maxZoom: 1 };

const BACKGROUND_FADE_ZOOM = 0.4;

/**
 * What a drop is allowed to do, decided against the document rather than the
 * flow arrays, so a refusal reads the same rule everywhere (spec 5.3).
 */
const isValidConnection: IsValidConnection<KartaFlowEdge> = makeIsValidConnection(
  () => useBoardStore.getState().doc,
);

/** Where the arrow that opened the picker came from, if one did. */
interface ConnectOrigin {
  id: Id;
  handle: HandleSide;
  rect: Rect;
}

interface ConnectMenuState {
  /** Position within the canvas wrapper, in pixels. */
  x: number;
  y: number;
  /** Where in the document the new node goes. */
  flow: XYPosition;
  /** `null` when the picker was opened on its own rather than by an arrow. */
  from: ConnectOrigin | null;
}

/** A frame drag carries the nodes inside it; `dx`/`dy` are the last frame applied. */
interface GroupDrag {
  id: Id;
  origin: XYPosition;
  members: Map<Id, XYPosition>;
  dx: number;
  dy: number;
}

/** The dot grid stops helping long before it stops being drawn (spec 7.3). */
function FadingBackground(): JSX.Element {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <Background
      variant={BackgroundVariant.Dots}
      gap={24}
      size={1.4}
      color="var(--line-strong)"
      className="karta-grid"
      style={{ opacity: zoom < BACKGROUND_FADE_ZOOM ? 0 : 1 }}
    />
  );
}

function CanvasSurface(): JSX.Element | null {
  const doc = useBoardStore((s) => s.doc);
  const boardId = useBoardStore((s) => s.boardId);
  const saveState = useBoardStore((s) => s.saveState);
  const view = useUiStore((s) => s.view);
  const dialog = useUiStore((s) => s.dialog);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<KartaFlowNode[]>([]);
  const edgesRef = useRef<KartaFlowEdge[]>([]);
  const pendingSelection = useRef<Id[] | null>(null);
  const groupDrag = useRef<GroupDrag | null>(null);
  const extracting = useRef(false);

  const [flowNodes, setFlowNodesState] = useState<KartaFlowNode[]>([]);
  const [flowEdges, setFlowEdgesState] = useState<KartaFlowEdge[]>([]);
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null);
  /** Where the selection menu was opened, in the wrapper's own pixels. */
  const [selectionMenu, setSelectionMenu] = useState<XYPosition | null>(null);

  /** A delete waiting on the "this board is not empty" question. */
  const [pendingDelete, setPendingDelete] = useState<{
    nodeIds: Id[];
    edgeIds: Id[];
    plan: DeletionPlan;
  } | null>(null);

  // Escape reads the menu without listing it as a dependency, so the keyboard
  // handlers are built once instead of once per frame.
  const connectMenuRef = useRef<ConnectMenuState | null>(null);
  connectMenuRef.current = connectMenu;
  const selectionMenuRef = useRef<XYPosition | null>(null);
  selectionMenuRef.current = selectionMenu;

  const { screenToFlowPosition, flowToScreenPosition, fitView, zoomTo, getViewport, getZoom } =
    useReactFlow<
    KartaFlowNode,
    KartaFlowEdge
  >();
  const altPressed = useKeyPress('Alt');

  /* --- selection: read by commands, rendered only as a count -------------- */

  const selection = useSelectionTracker();
  const selectionCounts = useSelectionCounts(selection);

  /* --- flow arrays: one writer, so callbacks never read a stale array ----- */

  const setFlowNodes = useCallback(
    (update: KartaFlowNode[] | ((prev: KartaFlowNode[]) => KartaFlowNode[])): void => {
      const next = typeof update === 'function' ? update(nodesRef.current) : update;
      if (next === nodesRef.current) return;
      nodesRef.current = next;
      setFlowNodesState(next);
    },
    [],
  );

  const setFlowEdges = useCallback(
    (update: KartaFlowEdge[] | ((prev: KartaFlowEdge[]) => KartaFlowEdge[])): void => {
      const next = typeof update === 'function' ? update(edgesRef.current) : update;
      if (next === edgesRef.current) return;
      edgesRef.current = next;
      setFlowEdgesState(next);
    },
    [],
  );

  const nodes = doc?.nodes;
  const edges = doc?.edges;

  useEffect(() => {
    const list = nodes ?? [];
    const pending = pendingSelection.current;
    pendingSelection.current = null;

    // The tracker is the one source of truth for what is selected: a fresh
    // node arrives unselected, and a deleted one never reports a change.
    if (pending) selection.setNodes(pending);
    else selection.retainNodes(list);

    setFlowNodes((prev) => withSelectionFlags(syncFlowNodes(prev, list), selection.nodes()));
  }, [nodes, selection, setFlowNodes]);

  useEffect(() => {
    const list = edges ?? [];
    selection.retainEdges(list);
    setFlowEdges((prev) => withSelectionFlags(syncFlowEdges(prev, list), selection.edges()));
  }, [edges, selection, setFlowEdges]);

  /* --- creating things --------------------------------------------------- */

  const centreOfView = useCallback((): XYPosition => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) {
      const viewport = getViewport();
      return { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom };
    }
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [getViewport, screenToFlowPosition]);

  /**
   * What the canvas does with a node the instant it exists. The palette and the
   * toolbar are mounted inside this surface and reach it through context, so a
   * card clicked out of the palette and one made with `N` are the same act
   * right down to what is selected afterwards.
   */
  const selectCreated = useCallback((node: BoardNode): void => {
    pendingSelection.current = [node.id];
  }, []);

  const createNode = useCallback(
    (choice: ConnectChoice, at: XYPosition, link?: CreateLink): BoardNode | null => {
      const node = createAt(choice, at, link);
      if (node !== null) selectCreated(node);
      return node;
    },
    [selectCreated],
  );

  /* --- selection --------------------------------------------------------- */

  const selectNodes = useCallback(
    (ids: Id[]): void => {
      selection.setNodes(ids);
      selection.setEdges([]);
      setFlowNodes((prev) => withSelectionFlags(prev, selection.nodes()));
      setFlowEdges((prev) => withSelectionFlags(prev, selection.edges()));
    },
    [selection, setFlowEdges, setFlowNodes],
  );

  const focusSurface = useCallback((): void => {
    const el = wrapperRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, []);

  /* --- React Flow callbacks ---------------------------------------------- */

  /*
   * `applyNodeChanges` returns a fresh array whatever it is handed, and a fresh
   * array is a full re-adoption of every node inside React Flow — so an empty
   * batch, which a gesture can produce, is dropped before it costs anything.
   */
  const guides = useRef(createGuideTracker()).current;

  /**
   * Snap a single-node drag to the neighbours' edges and centres before React
   * Flow applies it, which is the same seam React Flow's own helper-lines
   * example uses. Alt holds it off, exactly as it holds off the grid.
   *
   * Nothing here may allocate per frame beyond the one adjusted change: this
   * runs on every pointer move of every drag.
   */
  const alignChanges = useCallback(
    (changes: NodeChange<KartaFlowNode>[], current: KartaFlowNode[]): NodeChange<KartaFlowNode>[] => {
      const drag = draggedNode(changes as { type: string; id?: string; dragging?: boolean; position?: { x: number; y: number } }[]);
      if (drag === null) {
        guides.clear();
        return changes;
      }

      const moving = current.find((node) => node.id === drag.id);
      if (moving === undefined) return changes;

      const size = (node: KartaFlowNode): { w: number; h: number } => ({
        w: node.measured?.width ?? node.width ?? node.data.node.size.w,
        h: node.measured?.height ?? node.height ?? node.data.node.size.h,
      });

      const box = size(moving);
      const rect: AlignRect = { id: drag.id, x: drag.x, y: drag.y, w: box.w, h: box.h };

      const others: AlignRect[] = [];
      for (const node of current) {
        if (node.id === drag.id || node.hidden === true) continue;
        const s = size(node);
        others.push({ id: node.id, x: node.position.x, y: node.position.y, w: s.w, h: s.h });
      }

      const zoom = getZoom() || 1;
      const snapped = snapToNeighbours(rect, others, {
        threshold: ALIGN_REACH / zoom,
        connected: neighboursOf(drag.id, useBoardStore.getState().doc?.edges ?? []),
        connectedThreshold: ALIGN_REACH_CONNECTED / zoom,
      });

      guides.set(snapped.guides);
      if (snapped.x === drag.x && snapped.y === drag.y) return changes;

      return changes.map((change) =>
        change.type === 'position' && change.id === drag.id
          ? { ...change, position: { x: snapped.x, y: snapped.y } }
          : change,
      );
    },
    [getZoom, guides],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<KartaFlowNode>[]): void => {
      if (changes.length === 0) return;
      selection.readNodeChanges(changes);
      setFlowNodes((prev) => applyNodeChanges(alignChanges(changes, prev), prev));
    },
    [alignChanges, selection, setFlowNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<KartaFlowEdge>[]): void => {
      if (changes.length === 0) return;
      selection.readEdgeChanges(changes);
      setFlowEdges((prev) => applyEdgeChanges(changes, prev));
    },
    [selection, setFlowEdges],
  );

  const commitPositions = useCallback((moved: Map<Id, XYPosition>): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    if (!current || moved.size === 0) return;

    const changed = current.nodes.some((node) => {
      const next = moved.get(node.id);
      return (
        next !== undefined &&
        (Math.round(next.x) !== node.position.x || Math.round(next.y) !== node.position.y)
      );
    });
    if (!changed) return;

    store.mutate(moved.size === 1 ? 'Move node' : `Move ${moved.size} nodes`, (d) => {
      for (const node of d.nodes) {
        const next = moved.get(node.id);
        if (!next || node.locked) continue;
        node.position = { x: Math.round(next.x), y: Math.round(next.y) };
      }
    });
  }, []);

  const onNodeDragStart: OnNodeDrag<KartaFlowNode> = useCallback((_event, node, dragged) => {
    groupDrag.current = null;
    const board = node.data.node;
    if (board.kind !== 'group') return;

    const current = useBoardStore.getState().doc;
    if (!current) return;

    const alreadyMoving = new Set(dragged.map((n) => n.id));
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const members = new Map<Id, XYPosition>();
    for (const id of nodesInsideFrame(board, current.nodes)) {
      if (alreadyMoving.has(id)) continue;
      const flowNode = byId.get(id);
      if (flowNode) members.set(id, { ...flowNode.position });
    }
    if (members.size === 0) return;
    groupDrag.current = { id: node.id, origin: { ...node.position }, members, dx: 0, dy: 0 };
  }, []);

  const onNodeDrag: OnNodeDrag<KartaFlowNode> = useCallback(
    (_event, node) => {
      const drag = groupDrag.current;
      if (!drag || drag.id !== node.id) return;
      const dx = node.position.x - drag.origin.x;
      const dy = node.position.y - drag.origin.y;
      // Snapping means most pointer moves land on the offset already applied.
      if (dx === drag.dx && dy === drag.dy) return;
      drag.dx = dx;
      drag.dy = dy;
      setFlowNodes((prev) =>
        prev.map((candidate) => {
          const start = drag.members.get(candidate.id);
          if (!start) return candidate;
          return { ...candidate, position: { x: start.x + dx, y: start.y + dy } };
        }),
      );
    },
    [setFlowNodes],
  );

  const onNodeDragStop: OnNodeDrag<KartaFlowNode> = useCallback(
    (_event, node, dragged) => {
      guides.clear();
      const drag = groupDrag.current;
      groupDrag.current = null;

      // One write, at the end of the gesture, so a drag is one undo entry.
      const moved = new Map<Id, XYPosition>();
      for (const item of dragged) moved.set(item.id, item.position);
      moved.set(node.id, node.position);
      if (drag) {
        const byId = new Map(nodesRef.current.map((n) => [n.id, n.position]));
        for (const id of drag.members.keys()) {
          const at = byId.get(id);
          if (at) moved.set(id, at);
        }
      }
      commitPositions(moved);
    },
    [commitPositions, guides],
  );

  /**
   * Dragging an arrow's end onto another node, which React Flow calls
   * reconnection. The bends stay where they are: they were placed relative to
   * the board, not to the endpoint, and silently discarding them because the
   * far end moved would be the opposite of adjustable.
   */
  const onReconnect = useCallback(
    (oldEdge: KartaFlowEdge, connection: Connection): void => {
      const source = connection.source;
      const target = connection.target;
      if (source === null || target === null || source === target) return;

      const store = useBoardStore.getState();
      // The edge being moved is not its own duplicate.
      const others = (store.doc?.edges ?? []).filter((e) => e.id !== oldEdge.id);
      if (hasEdgeBetween(others, source, target)) {
        useUiStore.getState().toast('Those two are already joined that way', 'warn');
        return;
      }

      store.updateEdge(
        oldEdge.id,
        {
          source,
          target,
          sourceHandle: isHandleSide(connection.sourceHandle) ? connection.sourceHandle : 'right',
          targetHandle: isHandleSide(connection.targetHandle) ? connection.targetHandle : 'left',
        },
        'Reconnect arrow',
      );
    },
    [],
  );

  const onMoveEnd = useCallback((_event: unknown, viewport: Viewport): void => {
    useBoardStore.getState().setViewport(viewport);
  }, []);

  /* --- drawing an arrow (spec 5.3) --------------------------------------- */

  /*
   * The whole gesture is resolved when it ends. React Flow also offers
   * `onConnect`, which fires for a drop it judged valid — but it reports the
   * two ends and not the pointer, and where the pointer was is exactly what
   * decides which sides the arrow attaches to. Mounting both would add the
   * edge twice, so this is the one owner.
   */
  const onConnectStart: OnConnectStart = useCallback(() => {
    setConnectMenu(null);
    // A class rather than state: an arrow drag repaints every frame, and this
    // surface must not re-render on any of them.
    wrapperRef.current?.classList.add('is-connecting');
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, state) => {
      wrapperRef.current?.classList.remove('is-connecting');
      if (!state.fromNode) return;

      const store = useBoardStore.getState();
      const current = store.doc;
      if (!current) return;

      const fromId = state.fromNode.id;
      const plan = planDrop({
        doc: current,
        fromId,
        fromHandleId: state.fromHandle?.id,
        point: state.to,
        overId: state.toNode?.id ?? null,
        overHandleId: state.toHandle?.id ?? null,
      });

      switch (plan.action) {
        case 'connect':
          store.addEdgeToBoard(
            makeEdge({
              source: fromId,
              target: plan.target.id,
              sourceHandle: plan.sides.sourceHandle,
              targetHandle: plan.sides.targetHandle,
            }),
          );
          return;

        case 'refuse':
          useUiStore.getState().toast(REFUSAL_TEXT[plan.refusal], 'warn');
          return;

        case 'create': {
          const source = current.nodes.find((node) => node.id === fromId);
          if (!source) return;
          const rect = wrapperRef.current?.getBoundingClientRect();
          const screen = flowToScreenPosition(state.to);
          setConnectMenu({
            x: screen.x - (rect?.left ?? 0),
            y: screen.y - (rect?.top ?? 0),
            flow: state.to,
            from: { id: fromId, handle: plan.sourceHandle, rect: nodeRect(source) },
          });
          return;
        }

        default:
          return;
      }
    },
    [flowToScreenPosition],
  );

  /** The picker, opened on its own: no arrow, just "what goes here". */
  const openPicker = useCallback((screen: XYPosition, flow: XYPosition): void => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setConnectMenu({
      x: screen.x - (rect?.left ?? 0),
      y: screen.y - (rect?.top ?? 0),
      flow,
      from: null,
    });
  }, []);

  const pickFromConnectMenu = useCallback(
    (choice: ConnectChoice): void => {
      const menu = connectMenuRef.current;
      setConnectMenu(null);
      if (!menu) return;

      const from = menu.from;
      if (from === null) {
        createNode(choice, menu.flow);
        return;
      }

      // The node lands centred on the drop, so where it lands is known before
      // it exists — which is what lets the arrow be committed with it.
      const size = choiceSize(choice);
      const at = placementFor(choice, menu.flow);
      const box: Rect = { x: at.x, y: at.y, w: size.w, h: size.h };
      const sides = resolveSides(from.rect, box, rectCentre(box), from.handle);
      createNode(choice, menu.flow, { source: from.id, sides });
    },
    [createNode],
  );

  const closeConnectMenu = useCallback((): void => setConnectMenu(null), []);

  /* --- pointer on the field ---------------------------------------------- */

  const onPaneClick = useCallback((): void => {
    setConnectMenu(null);
    setSelectionMenu(null);
    focusSurface();
  }, [focusSurface]);

  const onPaneDoubleClick = useCallback(
    (event: ReactMouseEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('react-flow__pane')) return;
      createNode({ kind: 'card' }, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [createNode, screenToFlowPosition],
  );

  /*
   * Double-clicking the field makes a card, because that is the one thing it is
   * usually for (spec 9). Everything else it could have made is one press of
   * the right button away, at the same spot.
   */
  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent): void => {
      event.preventDefault();
      const screen = { x: event.clientX, y: event.clientY };
      openPicker(screen, screenToFlowPosition(screen));
    },
    [openPicker, screenToFlowPosition],
  );

  const onNodeDoubleClick: NodeMouseHandler<KartaFlowNode> = useCallback((_event, node) => {
    const kind = node.data.node.kind;
    // A board link opens its board from inside the node itself; text and shape
    // nodes put the caret in their own words.
    if (kind === 'card' || kind === 'note') useUiStore.getState().openEditor(node.id);
  }, []);

  /* --- clipboard: images (spec 7.3) and nodes (spec 9) ------------------- */

  const imageDrop = useCanvasImageDrop(boardId, screenToFlowPosition);

  /*
   * Two kinds of drag land here: an item from the palette, which carries its
   * own MIME type, and a file from the desktop. The palette is asked first and
   * hands the event on when it is not its own.
   */
  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      if (paletteDragOver(event)) return;
      imageDrop.onDragOver(event);
    },
    [imageDrop],
  );

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      if (paletteDrop(event, screenToFlowPosition, createNode) !== null) return;
      imageDrop.onDrop(event);
    },
    [createNode, imageDrop, screenToFlowPosition],
  );

  const onCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>): void => {
      // A field inside the canvas keeps its own copy behaviour.
      if (isEditableTarget(event.target)) return;

      const current = useBoardStore.getState().doc;
      const ids = selection.nodeIds();
      if (!current || ids.length === 0) return;
      const payload = collectForClipboard(current, ids);
      if (!payload) return;

      event.preventDefault();
      event.clipboardData.setData('text/plain', holdForClipboard(payload));
      useUiStore
        .getState()
        .toast(payload.nodes.length === 1 ? 'Copied 1 node' : `Copied ${payload.nodes.length} nodes`);
    },
    [selection],
  );

  /** True when the event carried our nodes, so the image handler can stand down. */
  const pasteNodesFromClipboard = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>): boolean => {
      if (isEditableTarget(event.target)) return false;
      const payload = payloadForMarker(event.clipboardData.getData('text/plain'));
      if (!payload) return false;

      const store = useBoardStore.getState();
      const current = store.doc;
      if (!current) return false;

      event.preventDefault();
      const ui = useUiStore.getState();
      const at = screenToFlowPosition(imageDrop.pointerPosition());
      const offset = offsetToCentre(payload.nodes, at, altPressed ? 1 : SNAP_GRID[0]);
      const paste = pasteNodes(current, payload, store.me?.userId ?? '', offset);

      if (paste.nodes.length === 0) {
        ui.toast('Those images live on another board — paste them there.', 'warn');
        return true;
      }

      pendingSelection.current = paste.nodes.map((node) => node.id);
      store.mutate(paste.nodes.length === 1 ? 'Paste node' : `Paste ${paste.nodes.length} nodes`, (d) => {
        d.nodes.push(...paste.nodes);
        d.edges.push(...paste.edges);
      });
      if (paste.skipped > 0) {
        ui.toast(
          paste.skipped === 1
            ? 'One image was left behind — its file lives on another board.'
            : `${paste.skipped} images were left behind — their files live on another board.`,
          'warn',
        );
      }
      return true;
    },
    [altPressed, imageDrop, screenToFlowPosition],
  );

  const onPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>): void => {
      if (pasteNodesFromClipboard(event)) return;
      imageDrop.onPaste(event);
    },
    [imageDrop, pasteNodesFromClipboard],
  );

  /* --- keyboard ---------------------------------------------------------- */

  /**
   * Remove the nodes and edges, and the boards behind any links among them.
   *
   * A link is a doorway and the board is the room: deleting the tile deletes
   * the board too, which is what "delete this" means when the tile is the only
   * thing on the canvas representing it. A board with anything on it stops for
   * a question first, because a tile the size of a card can be hiding a great
   * deal of work.
   */
  const purge = useCallback(
    async (nodeIds: Id[], edgeIds: Id[], boards: readonly DoomedBoard[]): Promise<void> => {
      const store = useBoardStore.getState();
      if (nodeIds.length > 0) store.removeNodes(nodeIds);
      if (edgeIds.length > 0) store.removeEdges(edgeIds);

      const deletable = boards.filter((b) => b.known);
      if (deletable.length === 0) return;

      // The nodes are already gone locally; the boards are separate documents
      // and each needs its own call. One failure must not hide the others, so
      // they are settled together and reported once.
      const results = await Promise.allSettled(deletable.map((b) => api.deleteBoard(b.boardId)));
      const failed = results.filter((r) => r.status === 'rejected').length;

      await store.loadIndex();

      const ui = useUiStore.getState();
      if (failed > 0) {
        ui.toast(
          failed === deletable.length
            ? 'The links were removed, but the boards could not be deleted.'
            : `${failed} of ${deletable.length} boards could not be deleted.`,
          'error',
        );
      } else {
        ui.toast(
          deletable.length === 1
            ? 'Board deleted. Storage keeps it for 14 days.'
            : `${deletable.length} boards deleted. Storage keeps them for 14 days.`,
        );
      }
    },
    [],
  );

  const removeSelection = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    if (!current) return;
    const locked = new Set(current.nodes.filter((node) => node.locked).map((node) => node.id));
    const nodeIds = selection.nodeIds().filter((id) => !locked.has(id));
    const edgeIds = selection.edgeIds();
    if (nodeIds.length === 0 && edgeIds.length === 0) return;

    const plan = planBoardDeletion(nodeIds, current.nodes, store.index);
    if (plan.withContent.length > 0) {
      // Hold the whole gesture until the question is answered, so a cancel
      // leaves the canvas exactly as it was.
      setPendingDelete({ nodeIds, edgeIds, plan });
      return;
    }
    void purge(nodeIds, edgeIds, plan.boards);
  }, [purge, selection]);

  const duplicateSelection = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    const ids = selection.nodeIds();
    if (!current || ids.length === 0) return;

    const copy = duplicateNodes(current, ids, store.me?.userId ?? '');
    if (copy.nodes.length === 0) return;

    pendingSelection.current = copy.nodes.map((node) => node.id);
    store.mutate(copy.nodes.length === 1 ? 'Duplicate node' : `Duplicate ${copy.nodes.length} nodes`, (d) => {
      d.nodes.push(...copy.nodes);
      d.edges.push(...copy.edges);
    });
  }, [selection]);

  const groupSelection = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    const wanted = selection.nodes();
    if (!current || wanted.size === 0) return;

    const frame = frameAround(
      current.nodes.filter((node) => wanted.has(node.id) && node.kind !== 'group'),
      store.me?.userId ?? '',
    );
    if (!frame) return;

    pendingSelection.current = [frame.id];
    store.addNode(frame);
  }, [selection]);

  const applyColor = useCallback(
    (color: ColorToken): void => {
      const nodeIds = selection.nodes();
      const edgeIds = selection.edges();
      if (nodeIds.size === 0 && edgeIds.size === 0) return;

      useBoardStore.getState().mutate('Apply colour', (d) => {
        for (const node of d.nodes) if (nodeIds.has(node.id) && !node.locked) node.color = color;
        for (const edge of d.edges) if (edgeIds.has(edge.id)) edge.color = color;
      });
    },
    [selection],
  );

  const nudge = useCallback(
    (dx: number, dy: number): void => {
      const wanted = selection.nodes();
      if (wanted.size === 0) return;
      useBoardStore.getState().mutate('Move nodes', (d) => {
        for (const node of d.nodes) {
          if (!wanted.has(node.id) || node.locked) continue;
          node.position = { x: node.position.x + dx, y: node.position.y + dy };
        }
      });
    },
    [selection],
  );

  const toggleCollapse = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    const wanted = selection.nodes();
    if (!current || wanted.size === 0) return;

    const cards = current.nodes.filter(
      (node): node is CardNode => node.kind === 'card' && wanted.has(node.id) && !node.locked,
    );
    if (cards.length === 0) return;

    const collapsed = nextCollapsed(cards);
    store.mutate(collapsed ? 'Collapse cards' : 'Expand cards', (d) => {
      for (const node of d.nodes) {
        if (node.kind === 'card' && wanted.has(node.id) && !node.locked) node.collapsed = collapsed;
      }
    });
  }, [selection]);

  const extract = useCallback((): void => {
    if (extracting.current) return;
    const ui = useUiStore.getState();
    const ids = selection.nodeIds();
    if (ids.length === 0) {
      ui.toast('Select the nodes to extract first', 'warn');
      return;
    }

    extracting.current = true;
    void extractToBoard(
      {
        getState: useBoardStore.getState,
        api,
        onWarning: (message) => ui.toast(message, 'warn'),
      },
      ids,
    )
      .then((result) => {
        ui.toast(`Moved ${result.nodeCount} nodes into “${result.title}”`);
      })
      .catch((error: unknown) => {
        ui.toast(error instanceof Error ? error.message : 'Could not extract to a board', 'error');
      })
      .finally(() => {
        extracting.current = false;
      });
  }, [selection]);

  /**
   * Locking is spec 5.2's own field, honoured everywhere on the canvas — a
   * locked node refuses a drag, a resize, a colour and a delete — and until the
   * menu existed nothing in the product could write it.
   */
  const setLocked = useCallback(
    (locked: boolean): void => {
      const wanted = selection.nodes();
      if (wanted.size === 0) return;
      const verb = locked ? 'Lock' : 'Unlock';
      useBoardStore.getState().mutate(wanted.size === 1 ? `${verb} node` : `${verb} nodes`, (d) => {
        for (const node of d.nodes) if (wanted.has(node.id)) node.locked = locked;
      });
    },
    [selection],
  );

  /* --- the selection menu (spec 5.2, spec 9) ----------------------------- */

  const selectionFacts = useCallback((): SelectionFacts => {
    const current = useBoardStore.getState().doc;
    if (!current) return NO_SELECTION;
    return readSelectionFacts(current.nodes, selection.nodes(), selection.edges().size);
  }, [selection]);

  /** Opened at a point in viewport pixels — a pointer, or a button's corner. */
  const openSelectionMenu = useCallback((screen: XYPosition): void => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setConnectMenu(null);
    setSelectionMenu({ x: screen.x - (rect?.left ?? 0), y: screen.y - (rect?.top ?? 0) });
  }, []);

  const closeSelectionMenu = useCallback((): void => {
    setSelectionMenu(null);
    // The caret came from the canvas and goes back to it: the menu is unmounting
    // under the focused item, and focus left on nothing is focus on the body.
    wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  const onNodeContextMenu: NodeMouseHandler<KartaFlowNode> = useCallback(
    (event, node) => {
      event.preventDefault();
      // Right-clicking outside the selection means "this one", the way it does
      // everywhere else — otherwise the menu would act on a crowd the user
      // cannot see they are still holding.
      if (!selection.nodes().has(node.id)) selectNodes([node.id]);
      openSelectionMenu({ x: event.clientX, y: event.clientY });
    },
    [openSelectionMenu, selectNodes, selection],
  );

  /**
   * The context-menu key fires `contextmenu` at whatever holds focus, which on
   * this surface is the wrapper itself — the key has already opened our own
   * menu on `keydown`, and the browser's must not open on top of it. A pointer
   * never reaches here with the wrapper as its target: the pane and the nodes
   * answer those, and both prevent it themselves.
   */
  const onWrapperContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) event.preventDefault();
  }, []);

  /**
   * The menu without a pointer: the context-menu key, and `Shift+F10` for the
   * keyboards that lack one. It opens on the corner of the selection's own box,
   * which is where the button on the box sits.
   */
  const onSurfaceKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const wanted = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
      if (!wanted || isEditableTarget(event.target)) return;

      const current = useBoardStore.getState().doc;
      const selected = selection.nodes();
      if (!current || selected.size === 0) return;
      const bounds = boundsOfNodes(current.nodes.filter((node) => selected.has(node.id)));
      if (!bounds) return;

      event.preventDefault();
      openSelectionMenu(flowToScreenPosition({ x: bounds.x + bounds.w, y: bounds.y }));
    },
    [flowToScreenPosition, openSelectionMenu, selection],
  );

  /**
   * The commands, handed to the menu and to the toolbar exactly as the keyboard
   * gets them. Nothing downstream reimplements one — `Ctrl+G` and *Group into a
   * frame* are the same call, so they cannot come to mean different things.
   */
  const selectionOps = useMemo<SelectionOps>(
    () => ({
      facts: selectionFacts,
      selectedNodeIds: () => selection.nodeIds(),
      openMenuAt: openSelectionMenu,
      group: groupSelection,
      extract,
      duplicate: duplicateSelection,
      applyColor,
      setLocked,
      remove: removeSelection,
    }),
    [
      applyColor,
      duplicateSelection,
      extract,
      groupSelection,
      openSelectionMenu,
      removeSelection,
      selection,
      selectionFacts,
      setLocked,
    ],
  );

  const shortcuts = useMemo<CanvasShortcutHandlers>(
    () => ({
      newCard: () => createNode({ kind: 'card' }, centreOfView()),
      newNote: () => createNode({ kind: 'note' }, centreOfView()),
      newText: () => createNode({ kind: 'text' }, centreOfView()),
      newShape: () => {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (!rect) return;
        openPicker(
          { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          centreOfView(),
        );
      },
      newBoard: () => {
        void createSubBoardAt(centreOfView());
      },
      openEditor: () => {
        const ids = selection.nodeIds();
        if (ids.length !== 1) return;
        const node = useBoardStore.getState().doc?.nodes.find((n) => n.id === ids[0]);
        if (node && (node.kind === 'card' || node.kind === 'note')) {
          useUiStore.getState().openEditor(node.id);
        }
      },
      escape: () => {
        const ui = useUiStore.getState();
        if (ui.editorNodeId !== null || ui.dialog !== null) return; // the shell owns those
        // Both menus stop Escape at the window before it reaches here; these
        // branches are what happens if one is open while the caret is not in it.
        if (selectionMenuRef.current) {
          setSelectionMenu(null);
          return;
        }
        if (connectMenuRef.current) {
          setConnectMenu(null);
          return;
        }
        selectNodes([]);
      },
      duplicate: duplicateSelection,
      deleteSelection: removeSelection,
      group: groupSelection,
      extract,
      zoomToFit: () => void fitView(FIT_VIEW_OPTIONS),
      zoomTo100: () => void zoomTo(1, { duration: 200 }),
      selectAll: () => selectNodes(nodesRef.current.map((node) => node.id)),
      toggleCollapse,
      applyColor,
      nudge,
    }),
    [
      applyColor,
      centreOfView,
      createNode,
      duplicateSelection,
      extract,
      fitView,
      groupSelection,
      nudge,
      openPicker,
      removeSelection,
      selectNodes,
      selection,
      toggleCollapse,
      zoomTo,
    ],
  );

  // A conflict is a blocking dialog that does not announce itself through
  // `ui.dialog` (spec 6.4), and nothing behind it may edit the document.
  useCanvasShortcuts(view === 'canvas' && dialog === null && saveState !== 'conflict', shortcuts);

  /* --- render ------------------------------------------------------------ */

  // The camera the board opened with. Frozen at mount: React Flow reads it
  // once, and a fresh object on every pan would re-arm the pan/zoom handler.
  const openingViewport = useRef<Viewport | null>(null);
  if (openingViewport.current === null && doc) openingViewport.current = doc.viewport;

  // Element identity is stable, so React skips these subtrees on every
  // re-render the marquee causes. Everything in them reads what it needs from
  // a store of its own.
  const chrome = useMemo(
    () => (
      <>
        <FadingBackground />
        <AlignmentGuides tracker={guides} />
        <Controls position="bottom-right" showInteractive={false} />
      </>
    ),
    [guides],
  );

  const furniture = useMemo(
    () => (
      <>
        <EmptyCanvasHint />
        <Palette />
        <SelectionAffordance />
        <CanvasToolbar />
      </>
    ),
    [],
  );

  const selectionLabel = describeSelection(selectionCounts);

  if (!doc) return null;

  return (
    /*
     * The tracker, handed to the two affordances that belong to one item — the
     * resize handles and the arrow editor. They read a count out of it and
     * mount nothing while a marquee is holding a crowd.
     *
     * Beneath it, the same selection as a set of *commands*: the menu on the
     * selection and the toolbar's menu both name operations that live here, and
     * naming them is all they do.
     */
    <SelectionScope.Provider value={selection}>
      <SelectionOpsContext.Provider value={selectionOps}>
        <NodeCreatedContext.Provider value={selectCreated}>
          <div
            ref={wrapperRef}
            className="karta-canvas"
            tabIndex={-1}
            onCopy={onCopy}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onKeyDown={onSurfaceKeyDown}
            onContextMenu={onWrapperContextMenu}
            onPointerDownCapture={focusSurface}
          >
            <ReactFlow<KartaFlowNode, KartaFlowEdge>
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onReconnect={onReconnect}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onNodeDoubleClick={onNodeDoubleClick}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              onPaneClick={onPaneClick}
              onPaneContextMenu={onPaneContextMenu}
              onNodeContextMenu={onNodeContextMenu}
              onDoubleClick={onPaneDoubleClick}
              onMoveEnd={onMoveEnd}
              isValidConnection={isValidConnection}
              defaultViewport={openingViewport.current ?? doc.viewport}
              minZoom={0.1}
              maxZoom={2.5}
              snapToGrid={!altPressed}
              snapGrid={SNAP_GRID}
              onlyRenderVisibleElements
              connectionMode={ConnectionMode.Loose}
              connectionRadius={28}
              connectionDragThreshold={CONNECT_DRAG_THRESHOLD}
              zoomOnScroll={false}
              zoomOnPinch
              zoomOnDoubleClick={false}
              zoomActivationKeyCode={ZOOM_KEYS}
              panOnScroll
              panOnDrag={PAN_ON_DRAG}
              panActivationKeyCode="Space"
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={MULTI_SELECT_KEYS}
              deleteKeyCode={null}
              nodeDragThreshold={2}
              elevateNodesOnSelect
              proOptions={PRO_OPTIONS}
            >
              {chrome}
            </ReactFlow>

            {furniture}

            <div className="karta-dock" aria-live="polite">
              {selectionLabel && <p className="karta-dock-chip">{selectionLabel}</p>}
              {imageDrop.uploading && <p className="karta-dock-chip">Adding image…</p>}
            </div>

            {connectMenu && (
              <ConnectMenu
                x={connectMenu.x}
                y={connectMenu.y}
                title={connectMenu.from === null ? 'Add to the board' : 'Add and connect'}
                onPick={pickFromConnectMenu}
                onNewBoard={
                  connectMenu.from === null
                    ? () => {
                        const at = connectMenu.flow;
                        closeConnectMenu();
                        void createSubBoardAt(at);
                      }
                    : undefined
                }
                onCancel={closeConnectMenu}
              />
            )}

            {selectionMenu && (
              <SelectionMenu x={selectionMenu.x} y={selectionMenu.y} onClose={closeSelectionMenu} />
            )}

            {pendingDelete && (
              <DeleteBoardsDialog
                boards={pendingDelete.plan.withContent}
                onCancel={() => setPendingDelete(null)}
                onKeepBoards={() => {
                  const { nodeIds, edgeIds } = pendingDelete;
                  setPendingDelete(null);
                  // The doorway goes, the rooms stay: no board ids passed.
                  void purge(nodeIds, edgeIds, []);
                }}
                onDeleteBoards={async () => {
                  const { nodeIds, edgeIds, plan } = pendingDelete;
                  setPendingDelete(null);
                  await purge(nodeIds, edgeIds, plan.boards);
                }}
              />
            )}
          </div>
        </NodeCreatedContext.Provider>
      </SelectionOpsContext.Provider>
    </SelectionScope.Provider>
  );
}

/**
 * The board as an infinite field (spec 7.3). One provider per board, so the
 * camera stored in the document is the camera the board opens with.
 */
export default function Canvas(): JSX.Element {
  const boardId = useBoardStore((s) => s.boardId);
  return (
    <ReactFlowProvider key={boardId ?? 'none'}>
      <CanvasSurface />
    </ReactFlowProvider>
  );
}
