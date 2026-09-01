import { MarkerType, Position, type EdgeMarker } from '@xyflow/react';
import type { BoardNode, Edge as BoardEdge, Handle as HandleSide } from '@/domain/board';
import { EDGE_STYLE, edgeColor } from '@/lib/colors';
import type { KartaFlowEdge, KartaFlowNode } from '@/canvas/types';

/** Frames paint under the arrows, arrows under everything else (spec 5.2). */
const Z_GROUP = 0;
const Z_EDGE = 1;
const Z_NODE = 2;

export const HANDLE_SIDES: readonly HandleSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * React Flow reports a handle id as a loose string, and a reconnection can
 * arrive with none at all. This is the guard back into the four sides the
 * document actually stores.
 */
export function isHandleSide(value: unknown): value is HandleSide {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

export const HANDLE_POSITION: Record<HandleSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/*
 * Which side an arrow reads a handle id as, and which side it should answer on,
 * both live in `canvas/connect.ts` — `sideFromHandleId` and `resolveSides`.
 * There is no second copy here: the perimeter handle has no side at all, and a
 * helper that does not know that would quietly get it wrong.
 */

function markerFor(marker: 'none' | 'arrow' | 'arrowopen', color: string): EdgeMarker | undefined {
  if (marker === 'none') return undefined;
  return {
    type: marker === 'arrow' ? MarkerType.ArrowClosed : MarkerType.Arrow,
    color,
    width: 16,
    height: 16,
  };
}

export function toFlowNode(node: BoardNode): KartaFlowNode {
  const isGroup = node.kind === 'group';
  // `z` is paint order within the board; frames ignore it and always sit under.
  const paint = Number.isFinite(node.z) ? Math.min(Math.max(Math.round(node.z), 0), 500) : 0;
  return {
    id: node.id,
    type: node.kind,
    position: { ...node.position },
    width: node.size.w,
    height: node.size.h,
    data: { node },
    draggable: !node.locked,
    connectable: !node.locked,
    // Deletion goes through the store so it lands in one undo entry (spec 9).
    deletable: false,
    zIndex: isGroup ? Z_GROUP : Z_NODE + paint,
    // A frame is only grabbable by its label, so it never swallows a marquee.
    dragHandle: isGroup ? '.karta-group-grip' : undefined,
  };
}

export function toFlowEdge(edge: BoardEdge): KartaFlowEdge {
  const stroke = edgeColor(edge.semantic, edge.color);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    reconnectable: true,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: 'semantic',
    data: { edge },
    zIndex: Z_EDGE,
    deletable: false,
    markerEnd: markerFor(EDGE_STYLE[edge.semantic].marker, stroke),
  };
}

/**
 * Rebuilds the flow arrays from the document while keeping the objects React
 * Flow already knows about. Selection and drag state live only in the flow
 * node, so they are carried across a rebuild.
 */
export function syncFlowNodes(previous: KartaFlowNode[], nodes: BoardNode[]): KartaFlowNode[] {
  const byId = new Map(previous.map((n) => [n.id, n]));
  let changed = previous.length !== nodes.length;

  const next = nodes.map((node, index) => {
    const old = byId.get(node.id);
    if (old && old.data.node === node) {
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    const fresh = toFlowNode(node);
    if (old) {
      fresh.selected = old.selected;
      fresh.dragging = old.dragging;
    }
    return fresh;
  });

  return changed ? next : previous;
}

export function syncFlowEdges(previous: KartaFlowEdge[], edges: BoardEdge[]): KartaFlowEdge[] {
  const byId = new Map(previous.map((e) => [e.id, e]));
  let changed = previous.length !== edges.length;

  const next = edges.map((edge, index) => {
    const old = byId.get(edge.id);
    if (old && old.data?.edge === edge) {
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    const fresh = toFlowEdge(edge);
    if (old) fresh.selected = old.selected;
    return fresh;
  });

  return changed ? next : previous;
}
