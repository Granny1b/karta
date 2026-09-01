/**
 * Making a node by dragging it off the palette (spec 7.3, spec 8.3).
 *
 * The gesture is draw.io's: an item is picked up from the panel on the left and
 * dropped where it belongs, and the same item activated with a click lands in
 * the middle of whatever is on screen. Both routes end in the same two lines —
 * `nodeForChoice` builds it, `addNode` commits it — so a shape made either way
 * is indistinguishable from the other afterwards, including in the undo stack.
 *
 * The payload travels as JSON on a private MIME type, because `dataTransfer`
 * only exposes its *types* during a drag: what is carried can be recognised
 * over the canvas, and only read once it is dropped.
 *
 * Nothing here touches the DOM. The two handlers the canvas mounts take the
 * event and a screen-to-flow converter, which leaves the placement arithmetic
 * testable without a browser.
 */

import { createContext, useCallback, useContext } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { isShapeKind, type BoardNode, type Id } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';
import { makeEdge } from '@/state/factories';
import { choiceSize, nodeForChoice, type ConnectChoice, type Point, type SidePair } from '@/canvas/connect';
import type { DragLike } from '@/media/paste';

/** Lowercase: `DataTransfer.types` reports every format folded to lower case. */
export const PALETTE_MIME = 'application/x-karta-palette';

/** Bumped if the payload shape ever changes; an older drag is then ignored. */
const PAYLOAD_VERSION = 1;

/** The canvas snaps to 8 px (spec 7.3), so a node arrives already on the grid. */
const GRID = 8;

/** A repeated click cascades instead of stacking, and returns after five. */
const CASCADE = 24;
const CASCADE_LIMIT = 5;

/**
 * The slice of `DataTransfer` this module touches. `DataTransfer` satisfies it,
 * and so can an object in a test — jsdom is not part of the test setup.
 */
export interface DragData {
  readonly types: readonly string[];
  getData(format: string): string;
  setData(format: string, data: string): void;
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/* ------------------------------------------------------------------ *
 * The payload
 * ------------------------------------------------------------------ */

/** Reads a choice back out of anything, refusing everything it does not know. */
function parseChoice(value: unknown): ConnectChoice | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'card' || kind === 'note' || kind === 'text') return { kind };
  if (kind === 'shape') {
    const shape = (value as { shape?: unknown }).shape;
    return isShapeKind(shape) ? { kind: 'shape', shape } : null;
  }
  return null;
}

/**
 * Loads a drag with what it will create. The human name rides along as plain
 * text so the drag still means something to anything outside this canvas.
 */
export function writePaletteDrag(data: DragData, choice: ConnectChoice, label: string): void {
  data.setData(PALETTE_MIME, JSON.stringify({ v: PAYLOAD_VERSION, choice }));
  data.setData('text/plain', label);
}

export function readPaletteDrag(data: DragData | null): ConnectChoice | null {
  if (!data) return null;
  const raw = data.getData(PALETTE_MIME);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  if ((parsed as { v?: unknown }).v !== PAYLOAD_VERSION) return null;
  return parseChoice((parsed as { choice?: unknown }).choice);
}

/** What can be known mid-drag: that this drag is one of ours. */
export function carriesPaletteDrag(data: Pick<DragData, 'types'> | null): boolean {
  return data ? data.types.includes(PALETTE_MIME) : false;
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

/**
 * The top-left corner that centres `choice` on `at`, on the grid. A drop lands
 * where the pointer is, the same promise double-clicking the canvas makes.
 */
export function placementFor(choice: ConnectChoice, at: Point): Point {
  const size = choiceSize(choice);
  return { x: snap(at.x - size.w / 2), y: snap(at.y - size.h / 2) };
}

/** How far the nth consecutive click at one spot steps off the last one. */
export function cascadeOffset(count: number): number {
  return (count % CASCADE_LIMIT) * CASCADE;
}

/* ------------------------------------------------------------------ *
 * Committing
 * ------------------------------------------------------------------ */

/**
 * An arrow to commit with the node, for the gestures that make both — a stub
 * clicked on a card, an arrow let go on empty canvas. The sides are already
 * resolved, because where the node lands is known before it exists.
 */
export interface CreateLink {
  /** The node the arrow leaves. */
  source: Id;
  sides: SidePair;
}

/**
 * Builds and adds the node `choice` names, centred on `at`, together with the
 * arrow to it when one was asked for. One gesture is one undo entry, so the
 * node and its arrow arrive in the same write.
 */
export function createAt(choice: ConnectChoice, at: Point, link?: CreateLink): BoardNode | null {
  const store = useBoardStore.getState();
  const doc = store.doc;
  if (!doc) return null;

  const node = nodeForChoice(doc, choice, placementFor(choice, at), store.me?.userId ?? '');
  if (link === undefined) {
    store.addNode(node);
    return node;
  }

  const edge = makeEdge({
    source: link.source,
    target: node.id,
    sourceHandle: link.sides.sourceHandle,
    targetHandle: link.sides.targetHandle,
  });
  store.mutate(`Add ${node.kind}`, (d) => {
    d.nodes.push(node);
    d.edges.push(edge);
  });
  return node;
}

/* ------------------------------------------------------------------ *
 * What the canvas mounts
 * ------------------------------------------------------------------ */

/**
 * `onDragOver`. Returns whether this drag belongs to the palette — false means
 * the canvas should offer the event to its image drop instead.
 */
export function paletteDragOver(event: DragLike): boolean {
  const data = event.dataTransfer;
  if (!data || !carriesPaletteDrag(data)) return false;
  // Without this the browser refuses the drop, whatever the handler says.
  event.preventDefault();
  data.dropEffect = 'copy';
  return true;
}

/**
 * `onDrop`. Returns the node that was created, or null if this was not ours —
 * null is the canvas's cue to offer the same event to its image drop.
 *
 * The creator is passed in rather than reached for, so a drop and a palette
 * click are the same act: whatever the canvas does with a new node, it does
 * here too.
 */
export function paletteDrop(
  event: DragLike,
  toFlow: (point: Point) => Point,
  create: (choice: ConnectChoice, at: Point) => BoardNode | null,
): BoardNode | null {
  const choice = readPaletteDrag(event.dataTransfer);
  if (!choice) return null;
  event.preventDefault();
  return create(choice, toFlow({ x: event.clientX, y: event.clientY }));
}

/* ------------------------------------------------------------------ *
 * The one creator
 * ------------------------------------------------------------------ */

/**
 * What the canvas does with a node the instant it exists — select it, so the
 * next keystroke (a colour, Enter, Delete) lands on the thing that just
 * appeared.
 *
 * It arrives as context because the palette and the toolbar are mounted inside
 * the canvas and otherwise know nothing about it; threading a prop through two
 * components that take none would be a worse trade than one line of provider.
 */
export type OnNodeCreated = (node: BoardNode) => void;

export const NodeCreatedContext = createContext<OnNodeCreated | null>(null);

/**
 * The single door onto the board. Every creation path in the canvas — the
 * palette, the toolbar, a drop, a double-click, a shortcut, the menu an arrow
 * opens — comes through here, so a node is indistinguishable afterwards from
 * one made any other way, including in the undo stack and in the selection.
 */
export function useCreateNode(): (
  choice: ConnectChoice,
  at: Point,
  link?: CreateLink,
) => BoardNode | null {
  const onCreated = useContext(NodeCreatedContext);
  return useCallback(
    (choice: ConnectChoice, at: Point, link?: CreateLink): BoardNode | null => {
      const node = createAt(choice, at, link);
      if (node !== null && onCreated !== null) onCreated(node);
      return node;
    },
    [onCreated],
  );
}

/* ------------------------------------------------------------------ *
 * Clicking instead of dragging
 * ------------------------------------------------------------------ */

/**
 * The current run of clicks at one spot. It is module state rather than a ref
 * because the palette and the toolbar's menu both place at the same centre,
 * and two components each counting their own run would stack one on the other.
 */
const run = { key: '', count: 0 };

/**
 * Place at the centre of the view, cascading while the view holds still: click
 * a palette item four times and there are four nodes, not one stack of four.
 * The run resets as soon as the camera moves, so a deliberate placement after
 * panning starts from the middle again.
 *
 * The only React Flow state read is `domNode`, which changes once per board —
 * subscribing to it costs nothing while the marquee is redrawing every frame.
 */
/**
 * The middle of what the user is looking at, in flow coordinates.
 *
 * Shared by the palette's click-to-place and by anything else that has to put
 * something where the eye already is. Falls back to the viewport transform when
 * the canvas has no measured box yet, which is the case on first paint.
 */
export function useViewCentre(): () => Point {
  const { screenToFlowPosition, getViewport } = useReactFlow();
  const domNode = useStore((state) => state.domNode);

  return useCallback((): Point => {
    const rect = domNode?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      return screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }
    const viewport = getViewport();
    return { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom };
  }, [domNode, getViewport, screenToFlowPosition]);
}

export function usePlaceAtCentre(): (choice: ConnectChoice) => BoardNode | null {
  const { screenToFlowPosition, getViewport } = useReactFlow();
  const domNode = useStore((state) => state.domNode);
  const create = useCreateNode();

  return useCallback(
    (choice: ConnectChoice): BoardNode | null => {
      const rect = domNode?.getBoundingClientRect();
      let centre: Point;
      if (rect && rect.width > 0) {
        centre = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      } else {
        const viewport = getViewport();
        centre = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom };
      }

      const key = `${Math.round(centre.x)}:${Math.round(centre.y)}`;
      run.count = run.key === key ? run.count + 1 : 0;
      run.key = key;

      const step = cascadeOffset(run.count);
      return create(choice, { x: centre.x + step, y: centre.y + step });
    },
    [create, domNode, getViewport, screenToFlowPosition],
  );
}
