import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
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
  useStore,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnectEnd,
  type OnNodeDrag,
  type XYPosition,
} from '@xyflow/react';
import {
  DEFAULT_NODE_SIZE,
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
import { cardNodes } from '@/state/selectors';
import { makeCard, makeEdge, makeNote, nextCardRank } from '@/state/factories';
import { useCanvasImageDrop } from '@/media/paste';
import ConnectMenu from '@/canvas/ConnectMenu';
import { collectForClipboard, holdForClipboard, payloadForMarker } from '@/canvas/clipboard';
import { extractToBoard } from '@/canvas/extract';
import { isHandleSide, oppositeSide, syncFlowEdges, syncFlowNodes } from '@/canvas/mapping';
import {
  duplicateNodes,
  frameAround,
  nextCollapsed,
  nodesInsideFrame,
  offsetToCentre,
  pasteNodes,
} from '@/canvas/ops';
import { edgeTypes } from '@/canvas/edges';
import { nodeTypes } from '@/canvas/nodes';
import { useCanvasShortcuts } from '@/canvas/useCanvasShortcuts';
import type { KartaFlowEdge, KartaFlowNode } from '@/canvas/types';
import '@xyflow/react/dist/style.css';
import './canvas.css';

const SNAP_GRID: [number, number] = [8, 8];
const BACKGROUND_FADE_ZOOM = 0.4;
/** Below this distance an ended connection was a click, not a drop. */
const STRAY_DROP_RADIUS = 20;

interface ConnectMenuState {
  x: number;
  y: number;
  flow: XYPosition;
  fromId: Id;
  fromHandle: HandleSide;
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
  const groupDrag = useRef<{ id: Id; origin: XYPosition; members: Map<Id, XYPosition> } | null>(null);
  const extracting = useRef(false);

  const [flowNodes, setFlowNodesState] = useState<KartaFlowNode[]>([]);
  const [flowEdges, setFlowEdgesState] = useState<KartaFlowEdge[]>([]);
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null);

  const { screenToFlowPosition, flowToScreenPosition, fitView, zoomTo, getViewport } = useReactFlow<
    KartaFlowNode,
    KartaFlowEdge
  >();
  const altPressed = useKeyPress('Alt');

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
    setFlowNodes((prev) => {
      let next = syncFlowNodes(prev, nodes ?? []);
      const pending = pendingSelection.current;
      if (pending) {
        pendingSelection.current = null;
        const wanted = new Set(pending);
        next = next.map((node) =>
          node.selected === wanted.has(node.id) ? node : { ...node, selected: wanted.has(node.id) },
        );
      }
      return next;
    });
  }, [nodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges((prev) => syncFlowEdges(prev, edges ?? []));
  }, [edges, setFlowEdges]);

  const selectedNodeIds = useMemo(
    () => flowNodes.filter((node) => node.selected).map((node) => node.id),
    [flowNodes],
  );
  const selectedEdgeIds = useMemo(
    () => flowEdges.filter((edge) => edge.selected).map((edge) => edge.id),
    [flowEdges],
  );

  /* --- creating things --------------------------------------------------- */

  const centreOfView = useCallback((): XYPosition => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) {
      const viewport = getViewport();
      return { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom };
    }
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [getViewport, screenToFlowPosition]);

  const createNode = useCallback((kind: 'card' | 'note', at: XYPosition): BoardNode | null => {
    const store = useBoardStore.getState();
    const current = store.doc;
    if (!current) return null;

    const size = DEFAULT_NODE_SIZE[kind];
    const position = { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) };
    const userId = store.me?.userId ?? '';
    const node: BoardNode =
      kind === 'card'
        ? makeCard({ userId, position, rank: nextCardRank(cardNodes(current), null) })
        : makeNote({ userId, position });

    pendingSelection.current = [node.id];
    store.addNode(node);
    return node;
  }, []);

  /* --- selection --------------------------------------------------------- */

  const selectNodes = useCallback(
    (ids: Id[]): void => {
      const wanted = new Set(ids);
      setFlowNodes((prev) =>
        prev.map((node) =>
          node.selected === wanted.has(node.id) ? node : { ...node, selected: wanted.has(node.id) },
        ),
      );
      setFlowEdges((prev) => prev.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
    },
    [setFlowEdges, setFlowNodes],
  );

  const focusSurface = useCallback((): void => {
    const el = wrapperRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, []);

  /* --- React Flow callbacks ---------------------------------------------- */

  const onNodesChange = useCallback(
    (changes: NodeChange<KartaFlowNode>[]): void => {
      setFlowNodes((prev) => applyNodeChanges(changes, prev));
    },
    [setFlowNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<KartaFlowEdge>[]): void => {
      setFlowEdges((prev) => applyEdgeChanges(changes, prev));
    },
    [setFlowEdges],
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
    const members = new Map<Id, XYPosition>();
    for (const id of nodesInsideFrame(board, current.nodes)) {
      if (alreadyMoving.has(id)) continue;
      const flowNode = nodesRef.current.find((n) => n.id === id);
      if (flowNode) members.set(id, { ...flowNode.position });
    }
    if (members.size === 0) return;
    groupDrag.current = { id: node.id, origin: { ...node.position }, members };
  }, []);

  const onNodeDrag: OnNodeDrag<KartaFlowNode> = useCallback(
    (_event, node) => {
      const drag = groupDrag.current;
      if (!drag || drag.id !== node.id) return;
      const dx = node.position.x - drag.origin.x;
      const dy = node.position.y - drag.origin.y;
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
      const drag = groupDrag.current;
      groupDrag.current = null;

      const moved = new Map<Id, XYPosition>();
      for (const item of dragged) moved.set(item.id, item.position);
      moved.set(node.id, node.position);
      if (drag) {
        for (const id of drag.members.keys()) {
          const flowNode = nodesRef.current.find((n) => n.id === id);
          if (flowNode) moved.set(id, flowNode.position);
        }
      }
      commitPositions(moved);
    },
    [commitPositions],
  );

  const onConnect = useCallback((connection: Connection): void => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const sourceHandle = isHandleSide(connection.sourceHandle) ? connection.sourceHandle : 'right';
    const targetHandle = isHandleSide(connection.targetHandle)
      ? connection.targetHandle
      : oppositeSide(sourceHandle);

    useBoardStore.getState().addEdgeToBoard(
      makeEdge({
        source: connection.source,
        target: connection.target,
        sourceHandle,
        targetHandle,
      }),
    );
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, state) => {
      if (!state.fromNode || state.toNode) return;
      // A click on a handle ends where it started; that is not a drop.
      if (Math.hypot(state.to.x - state.from.x, state.to.y - state.from.y) < STRAY_DROP_RADIUS) return;

      const rect = wrapperRef.current?.getBoundingClientRect();
      const screen = flowToScreenPosition(state.to);
      setConnectMenu({
        x: screen.x - (rect?.left ?? 0),
        y: screen.y - (rect?.top ?? 0),
        flow: state.to,
        fromId: state.fromNode.id,
        fromHandle: isHandleSide(state.fromHandle?.id) ? state.fromHandle.id : 'right',
      });
    },
    [flowToScreenPosition],
  );

  const pickFromConnectMenu = useCallback(
    (kind: 'card' | 'note'): void => {
      const menu = connectMenu;
      setConnectMenu(null);
      if (!menu) return;

      const node = createNode(kind, menu.flow);
      if (!node) return;
      useBoardStore.getState().addEdgeToBoard(
        makeEdge({
          source: menu.fromId,
          target: node.id,
          sourceHandle: menu.fromHandle,
          targetHandle: oppositeSide(menu.fromHandle),
        }),
      );
    },
    [connectMenu, createNode],
  );

  const onPaneClick = useCallback((): void => {
    setConnectMenu(null);
    focusSurface();
  }, [focusSurface]);

  const onPaneDoubleClick = useCallback(
    (event: ReactMouseEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('react-flow__pane')) return;
      createNode('card', screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [createNode, screenToFlowPosition],
  );

  const onNodeDoubleClick: NodeMouseHandler<KartaFlowNode> = useCallback((_event, node) => {
    const kind = node.data.node.kind;
    // A board link opens its board from inside the node itself.
    if (kind === 'card' || kind === 'note') useUiStore.getState().openEditor(node.id);
  }, []);

  /* --- clipboard: images (spec 7.3) and nodes (spec 9) ------------------- */

  const imageDrop = useCanvasImageDrop(boardId, screenToFlowPosition);

  const onCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>): void => {
      // A field inside the canvas keeps its own copy behaviour.
      if (isEditableTarget(event.target)) return;

      const current = useBoardStore.getState().doc;
      if (!current || selectedNodeIds.length === 0) return;
      const payload = collectForClipboard(current, selectedNodeIds);
      if (!payload) return;

      event.preventDefault();
      event.clipboardData.setData('text/plain', holdForClipboard(payload));
      useUiStore
        .getState()
        .toast(payload.nodes.length === 1 ? 'Copied 1 node' : `Copied ${payload.nodes.length} nodes`);
    },
    [selectedNodeIds],
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

  const removeSelection = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    if (!current) return;
    const locked = new Set(current.nodes.filter((node) => node.locked).map((node) => node.id));
    const nodeIds = selectedNodeIds.filter((id) => !locked.has(id));
    if (nodeIds.length > 0) store.removeNodes(nodeIds);
    if (selectedEdgeIds.length > 0) store.removeEdges(selectedEdgeIds);
  }, [selectedEdgeIds, selectedNodeIds]);

  const duplicateSelection = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    if (!current || selectedNodeIds.length === 0) return;

    const copy = duplicateNodes(current, selectedNodeIds, store.me?.userId ?? '');
    if (copy.nodes.length === 0) return;

    pendingSelection.current = copy.nodes.map((node) => node.id);
    store.mutate(copy.nodes.length === 1 ? 'Duplicate node' : `Duplicate ${copy.nodes.length} nodes`, (d) => {
      d.nodes.push(...copy.nodes);
      d.edges.push(...copy.edges);
    });
  }, [selectedNodeIds]);

  const groupSelection = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    if (!current || selectedNodeIds.length === 0) return;

    const wanted = new Set(selectedNodeIds);
    const frame = frameAround(
      current.nodes.filter((node) => wanted.has(node.id) && node.kind !== 'group'),
      store.me?.userId ?? '',
    );
    if (!frame) return;

    pendingSelection.current = [frame.id];
    store.addNode(frame);
  }, [selectedNodeIds]);

  const applyColor = useCallback(
    (color: ColorToken): void => {
      const store = useBoardStore.getState();
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      const nodeIds = new Set(selectedNodeIds);
      const edgeIds = new Set(selectedEdgeIds);

      store.mutate('Apply colour', (d) => {
        for (const node of d.nodes) if (nodeIds.has(node.id) && !node.locked) node.color = color;
        for (const edge of d.edges) if (edgeIds.has(edge.id)) edge.color = color;
      });
    },
    [selectedEdgeIds, selectedNodeIds],
  );

  const nudge = useCallback(
    (dx: number, dy: number): void => {
      if (selectedNodeIds.length === 0) return;
      const wanted = new Set(selectedNodeIds);
      useBoardStore.getState().mutate('Move nodes', (d) => {
        for (const node of d.nodes) {
          if (!wanted.has(node.id) || node.locked) continue;
          node.position = { x: node.position.x + dx, y: node.position.y + dy };
        }
      });
    },
    [selectedNodeIds],
  );

  const toggleCollapse = useCallback((): void => {
    const store = useBoardStore.getState();
    const current = store.doc;
    if (!current || selectedNodeIds.length === 0) return;

    const wanted = new Set(selectedNodeIds);
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
  }, [selectedNodeIds]);

  const extract = useCallback((): void => {
    if (extracting.current) return;
    const ui = useUiStore.getState();
    if (selectedNodeIds.length === 0) {
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
      selectedNodeIds,
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
  }, [selectedNodeIds]);

  // A conflict is a blocking dialog that does not announce itself through
  // `ui.dialog` (spec 6.4), and nothing behind it may edit the document.
  useCanvasShortcuts(view === 'canvas' && dialog === null && saveState !== 'conflict', {
    newCard: () => createNode('card', centreOfView()),
    newNote: () => createNode('note', centreOfView()),
    openEditor: () => {
      const id = selectedNodeIds[0];
      if (!id || selectedNodeIds.length !== 1) return;
      const node = useBoardStore.getState().doc?.nodes.find((n) => n.id === id);
      if (node && (node.kind === 'card' || node.kind === 'note')) useUiStore.getState().openEditor(id);
    },
    escape: () => {
      const ui = useUiStore.getState();
      if (ui.editorNodeId !== null || ui.dialog !== null) return; // the shell owns those
      if (connectMenu) {
        setConnectMenu(null);
        return;
      }
      selectNodes([]);
    },
    duplicate: duplicateSelection,
    deleteSelection: removeSelection,
    group: groupSelection,
    extract,
    zoomToFit: () => void fitView({ padding: 0.2, duration: 200, maxZoom: 1 }),
    zoomTo100: () => void zoomTo(1, { duration: 200 }),
    selectAll: () => selectNodes(nodesRef.current.map((node) => node.id)),
    toggleCollapse,
    applyColor,
    nudge,
  });

  if (!doc) return null;

  return (
    <div
      ref={wrapperRef}
      className="karta-canvas"
      tabIndex={-1}
      onCopy={onCopy}
      onPaste={onPaste}
      onDrop={imageDrop.onDrop}
      onDragOver={imageDrop.onDragOver}
      onPointerDownCapture={focusSurface}
    >
      <ReactFlow<KartaFlowNode, KartaFlowEdge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onDoubleClick={onPaneDoubleClick}
        onMoveEnd={(_event, viewport) => useBoardStore.getState().setViewport(viewport)}
        isValidConnection={(connection) => connection.source !== connection.target}
        defaultViewport={doc.viewport}
        minZoom={0.1}
        maxZoom={2.5}
        snapToGrid={!altPressed}
        snapGrid={SNAP_GRID}
        onlyRenderVisibleElements
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        zoomActivationKeyCode={['Control', 'Meta']}
        panOnScroll
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        deleteKeyCode={null}
        nodeDragThreshold={2}
        elevateNodesOnSelect
        proOptions={{ hideAttribution: false }}
      >
        <FadingBackground />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>

      {doc.nodes.length === 0 && (
        <p className="karta-empty">Double-click anywhere to add a card</p>
      )}

      {imageDrop.uploading && <p className="karta-uploading">Adding image…</p>}

      {connectMenu && (
        <ConnectMenu
          x={connectMenu.x}
          y={connectMenu.y}
          onPick={pickFromConnectMenu}
          onCancel={() => setConnectMenu(null)}
        />
      )}
    </div>
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
