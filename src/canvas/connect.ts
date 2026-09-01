import {
  DEFAULT_NODE_SIZE,
  type BoardDoc,
  type BoardNode,
  type Handle as HandleSide,
  type Id,
  type ShapeKind,
} from '@/domain/board';
import { makeCard, makeNote, makeShape, makeText, nextCardRank } from '@/state/factories';
import { cardNodes } from '@/state/selectors';

/**
 * The rules behind drawing an arrow (spec 5.3), kept away from React so they
 * can be read and tested on their own.
 *
 * The gesture this file serves is draw.io's: an arrow is started from a stub or
 * from the perimeter of a node, it is dropped anywhere on the target rather
 * than on a 6 px dot, and the sides it attaches to are worked out at the moment
 * of the drop from where the drag actually came from. Nothing here touches the
 * document; every function takes geometry in and hands an answer back.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Point, Size {}

/**
 * The id of the handle that covers a whole node. It is not a side, so an edge
 * can never store it — {@link resolveSides} works the side out instead.
 */
export const PERIMETER_HANDLE = 'perimeter';

/** The 8 px lattice `snapGrid` puts everything else on. */
const GRID = 8;

/** Canvas units left between a node and the one a stub click puts beside it. */
export const CONNECT_GAP = 56;

/**
 * Pointer travel, in screen pixels, that separates a click on a stub from a
 * drag off it. React Flow reads it as `connectionDragThreshold`, which is what
 * lets a stub carry both gestures without either one guessing.
 */
export const CONNECT_DRAG_THRESHOLD = 6;

/* ------------------------------------------------------------------ *
 * Rectangles
 * ------------------------------------------------------------------ */

export function nodeRect(node: BoardNode): Rect {
  return { x: node.position.x, y: node.position.y, w: node.size.w, h: node.size.h };
}

export function rectCentre(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The midpoint of one side — where a handle sits, and where an arrow lands. */
export function sideAnchor(rect: Rect, side: HandleSide): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.w / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case 'left':
      return { x: rect.x, y: rect.y + rect.h / 2 };
    default:
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
  }
}

export function containsPoint(rect: Rect, point: Point, pad = 0): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.w + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.h + pad
  );
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The side of `rect` that faces `point`.
 *
 * Each offset is measured against the half-extent it belongs to, so the answer
 * is about direction and not about how wide the rectangle happens to be: a
 * point above a 400 × 60 banner reads as `top`, which comparing raw distances
 * would not give.
 */
export function sideFacing(rect: Rect, point: Point): HandleSide {
  const centre = rectCentre(rect);
  const dx = (point.x - centre.x) / Math.max(rect.w / 2, 1);
  const dy = (point.y - centre.y) / Math.max(rect.h / 2, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The side a React Flow handle id names, or `null` for the perimeter. */
export function sideFromHandleId(id: string | null | undefined): HandleSide | null {
  return id === 'top' || id === 'right' || id === 'bottom' || id === 'left' ? id : null;
}

/* ------------------------------------------------------------------ *
 * Floating connections
 * ------------------------------------------------------------------ */

export interface SidePair {
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
}

/**
 * Which sides an arrow between two nodes should use — the floating connection,
 * resolved once, at the drop.
 *
 * The target side follows the drag: while the pointer is still outside the
 * target it is saying which way the arrow arrived. Once it is inside, it has
 * stopped saying anything useful and the source takes over. The source side
 * then turns to face whichever side was picked, unless the drag started from a
 * stub, which fixes it.
 */
export function resolveSides(
  source: Rect,
  target: Rect,
  point: Point,
  from: HandleSide | null = null,
): SidePair {
  const reference = containsPoint(target, point) ? rectCentre(source) : point;
  const targetHandle = sideFacing(target, reference);
  const sourceHandle = from ?? sideFacing(source, sideAnchor(target, targetHandle));
  return { sourceHandle, targetHandle };
}

/**
 * The node under a point in flow space. Frames paint underneath everything and
 * are scenery rather than subjects (spec 5.2), so they are never the answer;
 * among the rest the one painted last wins, which is what the pointer hit.
 */
export function nodeAtPoint(nodes: readonly BoardNode[], point: Point, pad = 0): BoardNode | null {
  let found: BoardNode | null = null;
  for (const node of nodes) {
    if (!isConnectableNode(node)) continue;
    if (!containsPoint(nodeRect(node), point, pad)) continue;
    if (found === null || node.z >= found.z) found = node;
  }
  return found;
}

/** Frames are scenery: an arrow neither starts nor ends on one. */
export function isConnectableNode(node: BoardNode): boolean {
  return node.kind !== 'group';
}

/* ------------------------------------------------------------------ *
 * What may be connected
 * ------------------------------------------------------------------ */

export type ConnectRefusal = 'self' | 'locked' | 'duplicate';

/** Said out loud when a drop is refused — a statement of fact, not an alarm. */
export const REFUSAL_TEXT: Record<ConnectRefusal, string> = {
  self: 'An arrow needs two different nodes',
  locked: 'That node is locked',
  duplicate: 'Those two are already connected',
};

/** The two ends of an edge, which is all duplicate detection needs to read. */
export interface EdgeEnds {
  source: Id;
  target: Id;
}

/** Direction is part of the statement: A → B and B → A are not the same edge. */
export function hasEdgeBetween(edges: readonly EdgeEnds[], source: Id, target: Id): boolean {
  return edges.some((edge) => edge.source === source && edge.target === target);
}

export interface ConnectEnd {
  id: Id;
  locked: boolean;
}

/** Why this drop cannot be accepted, or `null` when it can. */
export function connectRefusal(
  source: ConnectEnd,
  target: ConnectEnd,
  edges: readonly EdgeEnds[],
): ConnectRefusal | null {
  if (source.id === target.id) return 'self';
  if (source.locked || target.locked) return 'locked';
  if (hasEdgeBetween(edges, source.id, target.id)) return 'duplicate';
  return null;
}

export function canConnect(
  source: ConnectEnd,
  target: ConnectEnd,
  edges: readonly EdgeEnds[],
): boolean {
  return connectRefusal(source, target, edges) === null;
}

/**
 * The predicate React Flow consults before it will light a target up or accept
 * a drop on it. It reads the document rather than the flow arrays so a refusal
 * is decided by the same rules everywhere.
 */
export function makeIsValidConnection(
  getDoc: () => BoardDoc | null,
): (connection: { source: string | null; target: string | null }) => boolean {
  return (connection) => {
    const doc = getDoc();
    if (!doc || connection.source === null || connection.target === null) return false;
    const source = doc.nodes.find((node) => node.id === connection.source);
    const target = doc.nodes.find((node) => node.id === connection.target);
    if (!source || !target) return false;
    if (!isConnectableNode(source) || !isConnectableNode(target)) return false;
    return canConnect(source, target, doc.edges);
  };
}

/* ------------------------------------------------------------------ *
 * Placing what an arrow creates
 * ------------------------------------------------------------------ */

const snap = (value: number): number => Math.round(value / GRID) * GRID;

/**
 * Where a node hung off `side` of `from` belongs: centred on that side, one gap
 * clear of it, on the same 8 px lattice a dragged node lands on.
 */
export function placeBeside(from: Rect, side: HandleSide, size: Size, gap = CONNECT_GAP): Point {
  const centre = rectCentre(from);
  switch (side) {
    case 'top':
      return { x: snap(centre.x - size.w / 2), y: snap(from.y - gap - size.h) };
    case 'bottom':
      return { x: snap(centre.x - size.w / 2), y: snap(from.y + from.h + gap) };
    case 'left':
      return { x: snap(from.x - gap - size.w), y: snap(centre.y - size.h / 2) };
    default:
      return { x: snap(from.x + from.w + gap), y: snap(centre.y - size.h / 2) };
  }
}

/** Far enough to walk out of a column of cards, short of walking to the moon. */
const MAX_SHOVES = 12;

/**
 * {@link placeBeside}, pushed further along the same direction until it is not
 * landing on top of something. A board is a pile of rectangles and the fastest
 * gesture on it must not be the one that buries a node.
 */
export function placeConnected(
  nodes: readonly BoardNode[],
  from: Rect,
  side: HandleSide,
  size: Size,
  gap = CONNECT_GAP,
): Point {
  const stride = (side === 'left' || side === 'right' ? size.w : size.h) + gap;
  for (let shove = 0; shove <= MAX_SHOVES; shove += 1) {
    const at = placeBeside(from, side, size, gap + shove * stride);
    const box: Rect = { x: at.x, y: at.y, w: size.w, h: size.h };
    const clear = !nodes.some((node) => isConnectableNode(node) && rectsOverlap(nodeRect(node), box));
    if (clear) return at;
  }
  return placeBeside(from, side, size, gap);
}

/** The top-left corner that puts a node of `size` around `centre`. */
export function topLeftAround(centre: Point, size: Size): Point {
  return { x: Math.round(centre.x - size.w / 2), y: Math.round(centre.y - size.h / 2) };
}

/* ------------------------------------------------------------------ *
 * What an arrow can create
 * ------------------------------------------------------------------ */

/** The kinds an arrow gesture can conjure — everything that means something blank. */
export type ConnectChoice =
  | { kind: 'card' }
  | { kind: 'note' }
  | { kind: 'text' }
  | { kind: 'shape'; shape: ShapeKind };

export function choiceSize(choice: ConnectChoice): Size {
  return { ...DEFAULT_NODE_SIZE[choice.kind] };
}

/**
 * What clicking a stub on `node` should put beside it: the same thing again,
 * wherever a blank one means something. A screenshot or a nested board cannot
 * be conjured empty, so those answer with a card.
 */
export function echoChoice(node: BoardNode): ConnectChoice {
  switch (node.kind) {
    case 'note':
      return { kind: 'note' };
    case 'text':
      return { kind: 'text' };
    case 'shape':
      return { kind: 'shape', shape: node.shape };
    default:
      return { kind: 'card' };
  }
}

/** Builds the node a choice names, placed by its top-left corner. */
export function nodeForChoice(
  doc: BoardDoc,
  choice: ConnectChoice,
  position: Point,
  userId: string,
): BoardNode {
  const at = { x: Math.round(position.x), y: Math.round(position.y) };
  switch (choice.kind) {
    case 'note':
      return makeNote({ userId, position: at });
    case 'text':
      return makeText({ userId, position: at });
    case 'shape':
      return makeShape({ userId, position: at, shape: choice.shape });
    default:
      return makeCard({ userId, position: at, rank: nextCardRank(cardNodes(doc), null) });
  }
}

export interface StubPlan {
  choice: ConnectChoice;
  position: Point;
  sides: SidePair;
}

/**
 * Everything a click on the `side` stub of `node` needs: what to create, where
 * to put it, and which sides the arrow between them uses.
 */
export function planStubClick(doc: BoardDoc, node: BoardNode, side: HandleSide): StubPlan {
  const choice = echoChoice(node);
  const size = choiceSize(choice);
  const from = nodeRect(node);
  const position = placeConnected(doc.nodes, from, side, size);
  const box: Rect = { x: position.x, y: position.y, w: size.w, h: size.h };
  return { choice, position, sides: resolveSides(from, box, rectCentre(box), side) };
}

/* ------------------------------------------------------------------ *
 * Dropping a drag
 * ------------------------------------------------------------------ */

/**
 * What should happen when a connection drag is let go.
 *
 * - `connect` — it landed on a node that will take it.
 * - `refuse` — it landed on a node that will not, and the reason is worth saying.
 * - `create` — it landed on the canvas, so the menu opens and the arrow waits.
 * - `none`   — it landed back where it started, which is how a drag is cancelled.
 */
export type DropPlan =
  | { action: 'connect'; target: BoardNode; sides: SidePair }
  | { action: 'refuse'; target: BoardNode; refusal: ConnectRefusal }
  | { action: 'create'; sourceHandle: HandleSide }
  | { action: 'none' };

export function planDrop(params: {
  doc: BoardDoc;
  fromId: Id;
  fromHandleId: string | null | undefined;
  point: Point;
  /** The node React Flow itself resolved, when its own hit test found one. */
  overId?: Id | null;
  /** The handle it resolved with it — a side here was aimed at deliberately. */
  overHandleId?: string | null;
}): DropPlan {
  const { doc, fromId, fromHandleId, point } = params;
  const source = doc.nodes.find((node) => node.id === fromId);
  if (!source || !isConnectableNode(source)) return { action: 'none' };

  const from = sideFromHandleId(fromHandleId);
  const over = params.overId == null ? null : (doc.nodes.find((n) => n.id === params.overId) ?? null);
  const target = over !== null && isConnectableNode(over) ? over : nodeAtPoint(doc.nodes, point);

  if (target !== null) {
    // Letting go over the node the drag came from is how a drag is called off.
    if (target.id === source.id) return { action: 'none' };
    const refusal = connectRefusal(source, target, doc.edges);
    if (refusal !== null) return { action: 'refuse', target, refusal };

    // Landing on a stub names a side outright; anything else is worked out.
    const sides = resolveSides(nodeRect(source), nodeRect(target), point, from);
    const aimed = sideFromHandleId(params.overHandleId);
    return {
      action: 'connect',
      target,
      sides: aimed === null ? sides : { sourceHandle: sides.sourceHandle, targetHandle: aimed },
    };
  }

  const rect = nodeRect(source);
  if (containsPoint(rect, point)) return { action: 'none' };
  return { action: 'create', sourceHandle: from ?? sideFacing(rect, point) };
}
