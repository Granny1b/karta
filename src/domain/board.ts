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

export const SCHEMA_VERSION = 1 as const;

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

export type BoardNode = CardNode | ImageNode | NoteNode | BoardLinkNode | GroupNode;
export type NodeKind = BoardNode['kind'];

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
  schemaVersion: 1;
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
  schemaVersion: 1;
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

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

/** Default statuses on a new board: Idé → Planerad → Bygger → Testar → Klar. */
export const DEFAULT_STATUS_NAMES: ReadonlyArray<{ name: string; color: ColorToken; isDone: boolean }> = [
  { name: 'Idé', color: 'slate', isDone: false },
  { name: 'Planerad', color: 'straw', isDone: false },
  { name: 'Bygger', color: 'bronze', isDone: false },
  { name: 'Testar', color: 'blue', isDone: false },
  { name: 'Klar', color: 'teal', isDone: true },
];

export const DEFAULT_NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  card: { w: 240, h: 140 },
  note: { w: 200, h: 160 },
  image: { w: 320, h: 240 },
  boardLink: { w: 240, h: 120 },
  group: { w: 480, h: 360 },
};
