/**
 * Shared board domain types — the single source of truth for `BoardDoc`.
 *
 * This file is imported by the frontend (`@/domain/board`) and by the API
 * (`@domain/board`, aliased at `api/tsconfig.json`). It must stay free of
 * runtime dependencies so both sides can consume it unchanged.
 */

export type Id = string; // ULID — sortable, 26 chars
export type Iso = string; // ISO 8601 UTC

export type ColorToken =
  | 'straw'
  | 'bronze'
  | 'copper'
  | 'purple'
  | 'blue'
  | 'teal'
  | 'slate';

export type HexColor = string; // #RRGGBB

/**
 * Version 2 added the canvas-only `text` and `shape` nodes (spec 5.2). The
 * change is purely additive — no node that existed under 1 changed shape — so
 * the 1 → 2 migration in `api/src/domain/migrate.ts` is an identity step.
 */
export const SCHEMA_VERSION = 3 as const;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Acl {
  ownerId: string; // SWA userId claim
  editorIds: string[];
  viewerIds: string[];
}

export interface StatusDef {
  id: Id;
  name: string;
  color: ColorToken;
  order: number;
  isDone: boolean;
}

export interface LabelDef {
  id: Id;
  name: string;
  color: ColorToken;
}

export interface ChecklistItem {
  id: Id;
  text: string;
  done: boolean;
  rank: string;
}

export interface NodeBase {
  id: Id;
  kind: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
  z: number;
  color: ColorToken | HexColor | null;
  createdAt: Iso;
  updatedAt: Iso;
  updatedBy: string;
  locked: boolean;
}

export interface CardNode extends NodeBase {
  kind: 'card';
  title: string;
  body: string; // markdown
  checklist: ChecklistItem[];
  statusId: Id | null; // null = "No status" column
  rank: string; // fractional index within its column
  labelIds: Id[];
  coverMediaId: Id | null;
  dueDate: Iso | null;
  collapsed: boolean;
}

export interface ImageNode extends NodeBase {
  kind: 'image';
  mediaId: Id;
  naturalSize: { w: number; h: number };
  caption: string | null;
  fit: 'contain' | 'cover';
}

export interface NoteNode extends NodeBase {
  kind: 'note';
  text: string;
}

export interface BoardLinkNode extends NodeBase {
  kind: 'boardLink';
  targetBoardId: Id;
  cachedTitle: string;
  cachedCounts: { total: number; done: number } | null;
}

export interface GroupNode extends NodeBase {
  kind: 'group';
  title: string;
  padding: number;
}

/**
 * Free text laid directly on the canvas — a heading over a cluster, an aside
 * next to a diagram. No frame, no fill: `NodeBase.color` is the ink.
 */
export interface TextNode extends NodeBase {
  kind: 'text';
  text: string;
  fontSize: number; // px, canvas units
  align: 'left' | 'center' | 'right';
  weight: 'regular' | 'bold';
}

/** The draw.io vocabulary, drawn from `src/canvas/shapes.ts`'s geometry. */
export type ShapeKind =
  | 'rectangle'
  | 'roundedRect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'hexagon'
  | 'cylinder'
  | 'parallelogram'
  | 'cloud'
  | 'document'
  | 'process'
  | 'callout';

export interface ShapeNode extends NodeBase {
  kind: 'shape';
  shape: ShapeKind;
  label: string; // centred text inside the shape
  fill: ColorToken | HexColor | null; // null = no fill, outline only
  stroke: ColorToken | HexColor | null; // null = --line-strong
}

export type BoardNode =
  | CardNode
  | ImageNode
  | NoteNode
  | BoardLinkNode
  | GroupNode
  | TextNode
  | ShapeNode;
export type NodeKind = BoardNode['kind'];

/** Every `ShapeKind`, for runtime checks. Palette *order* lives in `canvas/shapes.ts`. */
export const SHAPE_KINDS: readonly ShapeKind[] = [
  'rectangle',
  'roundedRect',
  'ellipse',
  'diamond',
  'triangle',
  'hexagon',
  'cylinder',
  'parallelogram',
  'cloud',
  'document',
  'process',
  'callout',
];

/* ------------------------------------------------------------------ *
 * Field length limits
 *
 * One number per field, in one place, imported by both halves. The client
 * caps what a person can type or paste at exactly what
 * `api/src/domain/validate.ts` will accept, and `src/io/schema.ts` truncates
 * an import to the same figure — so no value that can reach a document is a
 * value the API refuses.
 *
 * That is the whole point of hoisting them: a document the API refuses is
 * refused again by every autosave after it, with nothing on screen naming the
 * field at fault, which is how saving wedged twice in this project. A number
 * copied into three files is a number that will drift in two of them.
 * ------------------------------------------------------------------ */

/** Card title, group title, board title — and the reference an edge names one by. */
export const MAX_TITLE = 300;
/** Status and label names. */
export const MAX_NAME = 120;
/** A card body: markdown, and so the one field allowed to be long. */
export const MAX_CARD_BODY = 200_000;
/** One checklist line. */
export const MAX_CHECKLIST_TEXT = 2_000;
/** A note's text and a text node's body — the two free-prose node fields. */
export const MAX_NODE_TEXT = 20_000;
/** An arrow's label, and an image's caption: one line annotating something else. */
export const MAX_EDGE_LABEL = 300;
/** A board icon — one emoji, with room for a compound one. */
export const MAX_ICON = 64;

/**
 * A shape label is a caption, not a body: one line, two at a push. The number
 * lives here because both halves have to agree on it — the editor caps its
 * field at exactly what `api/src/domain/validate.ts` will accept, so no label
 * a person can type can produce a document the API refuses.
 */
export const MAX_SHAPE_LABEL = 300;

/**
 * Trim a string to what the API will store, never through half a surrogate
 * pair: a cut between the two halves of an emoji leaves a lone surrogate,
 * which no font draws and which a JSON round trip turns into U+FFFD.
 */
export function capText(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  const splitPair = last >= 0xd800 && last <= 0xdbff;
  return splitPair ? cut.slice(0, -1) : cut;
}

/**
 * The cap for a note's text and a text node's body, applied where the value
 * is committed.
 *
 * `maxLength` on the field is the visible half of the rule and not the
 * enforceable half — a programmatic paste bypasses it in several browsers —
 * so the cap is applied on commit as well as on the field.
 */
export const capNodeText = (value: string): string => capText(value, MAX_NODE_TEXT);

export const TEXT_ALIGNS: readonly TextNode['align'][] = ['left', 'center', 'right'];
export const TEXT_WEIGHTS: readonly TextNode['weight'][] = ['regular', 'bold'];

/** Body size on the canvas at zoom 1 — one step up from a card's 14 px body. */
export const DEFAULT_TEXT_SIZE = 20;
/** Bounds a stored `fontSize`: below 8 it cannot be read, above 200 it is a wall. */
export const MIN_TEXT_SIZE = 8;
export const MAX_TEXT_SIZE = 200;

export const isShapeKind = (v: unknown): v is ShapeKind =>
  typeof v === 'string' && (SHAPE_KINDS as readonly string[]).includes(v);

export type Handle = 'top' | 'right' | 'bottom' | 'left';
export type EdgeSemantic = 'relates' | 'depends' | 'blocks' | 'derives';
export type EdgeRouting = 'bezier' | 'smoothstep' | 'straight';

export interface Edge {
  id: Id;
  source: Id;
  sourceHandle: Handle;
  target: Id;
  targetHandle: Handle;
  semantic: EdgeSemantic;
  label: string | null;
  routing: EdgeRouting;
  color: ColorToken | HexColor | null;
  updatedAt: Iso;
}

export type MediaContentType = 'image/webp' | 'image/png' | 'image/jpeg';

export interface MediaRef {
  id: Id;
  blobPath: string; // media/{boardId}/{mediaId}.webp
  thumbPath: string;
  contentType: MediaContentType;
  bytes: number;
  width: number;
  height: number;
  uploadedAt: Iso;
  uploadedBy: string;
}

export interface BoardDoc {
  schemaVersion: typeof SCHEMA_VERSION;
  id: Id;
  parentBoardId: Id | null;
  title: string;
  icon: string | null;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
  acl: Acl;
  viewport: Viewport;
  statuses: StatusDef[];
  labels: LabelDef[];
  nodes: BoardNode[];
  edges: Edge[];
  media: MediaRef[];
}

export interface BoardSummary {
  id: Id;
  parentBoardId: Id | null;
  title: string;
  icon: string | null;
  updatedAt: Iso;
  deletedAt: Iso | null;
  counts: { cards: number; done: number; children: number };
  ownerId: string;
}

export interface BoardIndex {
  schemaVersion: typeof SCHEMA_VERSION;
  updatedAt: Iso;
  boards: BoardSummary[];
}

export interface SnapshotRef {
  name: string; // {iso8601}.json
  createdAt: Iso;
  bytes: number;
}

export interface UploadTarget {
  mediaId: Id;
  blobPath: string;
  thumbPath: string;
  uploadUrl: string;
  thumbUploadUrl: string;
}

/** Identity as returned by `GET /api/me`. */
export interface Me {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

/* ------------------------------------------------------------------ *
 * Size budget (spec 5.6)
 * ------------------------------------------------------------------ */

export const SIZE_WARN_NODES = 300;
export const SIZE_WARN_BYTES = 400_000;
export const SIZE_HARD_STOP_BYTES = 1_000_000;
export const MAX_MEDIA_BYTES = 10_485_760;

/* ------------------------------------------------------------------ *
 * Type guards
 * ------------------------------------------------------------------ */

export const isCardNode = (n: BoardNode): n is CardNode => n.kind === 'card';
export const isImageNode = (n: BoardNode): n is ImageNode => n.kind === 'image';
export const isNoteNode = (n: BoardNode): n is NoteNode => n.kind === 'note';
export const isBoardLinkNode = (n: BoardNode): n is BoardLinkNode => n.kind === 'boardLink';
export const isGroupNode = (n: BoardNode): n is GroupNode => n.kind === 'group';
export const isTextNode = (n: BoardNode): n is TextNode => n.kind === 'text';
export const isShapeNode = (n: BoardNode): n is ShapeNode => n.kind === 'shape';

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

/** Default statuses on a new board: Idea → Planned → Building → Testing → Done. */
export const DEFAULT_STATUS_NAMES: ReadonlyArray<{ name: string; color: ColorToken; isDone: boolean }> = [
  { name: 'Idea', color: 'slate', isDone: false },
  { name: 'Planned', color: 'straw', isDone: false },
  { name: 'Building', color: 'bronze', isDone: false },
  { name: 'Testing', color: 'blue', isDone: false },
  { name: 'Done', color: 'teal', isDone: true },
];

export const DEFAULT_NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  card: { w: 240, h: 140 },
  note: { w: 200, h: 160 },
  image: { w: 320, h: 240 },
  boardLink: { w: 240, h: 120 },
  group: { w: 480, h: 360 },
  // A card's width, so a heading dropped above a column of cards lines up with
  // them; one line of DEFAULT_TEXT_SIZE plus the 8 px the renderer pads with.
  text: { w: 240, h: 48 },
  // Two 80 px modules wide against a card's three, and tall enough that the
  // pointed shapes — diamond, triangle — still hold a two-word label.
  shape: { w: 160, h: 100 },
};
