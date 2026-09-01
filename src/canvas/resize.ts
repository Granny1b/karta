import type { BoardNode, NodeKind } from '@/domain/board';

/**
 * Resize floors, so a node can never be dragged down to something too small to
 * grab again. React Flow enforces them during the gesture; they are applied a
 * second time on commit because the document is the thing that has to be sane.
 */
export const MIN_NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  card: { w: 120, h: 64 },
  note: { w: 120, h: 64 },
  image: { w: 96, h: 72 },
  boardLink: { w: 160, h: 88 },
  group: { w: 160, h: 120 },
  // Free text is bounded by the words in it rather than by a frame, so the
  // floor is one short line; a shape only has to stay big enough to grab.
  text: { w: 80, h: 24 },
  shape: { w: 48, h: 40 },
};

/** The shape React Flow's `onResizeEnd` reports: the node's final box. */
export interface ResizeParamsLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeGeometry {
  position: { x: number; y: number };
  size: { w: number; h: number };
}

/**
 * The geometry a finished resize should write, or `null` when there is nothing
 * to write: the node is locked, or the box came back where it started.
 *
 * Position travels with the size deliberately — dragging a top or left handle
 * moves the node's origin as well as its extent, and positions are otherwise
 * only ever committed by a drag, which a resize is not.
 */
export function resizeGeometry(node: BoardNode, params: ResizeParamsLike): NodeGeometry | null {
  if (node.locked) return null;

  const min = MIN_NODE_SIZE[node.kind];
  const position = { x: Math.round(params.x), y: Math.round(params.y) };
  const size = {
    w: Math.max(min.w, Math.round(params.width)),
    h: Math.max(min.h, Math.round(params.height)),
  };

  const unchanged =
    position.x === node.position.x &&
    position.y === node.position.y &&
    size.w === node.size.w &&
    size.h === node.size.h;

  return unchanged ? null : { position, size };
}
