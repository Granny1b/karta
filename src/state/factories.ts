import {
  DEFAULT_NODE_SIZE,
  DEFAULT_STATUS_NAMES,
  DEFAULT_TEXT_SIZE,
  SCHEMA_VERSION,
  type BoardDoc,
  type BoardLinkNode,
  type CardNode,
  type ChecklistItem,
  type Edge,
  type GroupNode,
  type Id,
  type ImageNode,
  type LabelDef,
  type NodeBase,
  type NodeKind,
  type NoteNode,
  type ShapeKind,
  type ShapeNode,
  type StatusDef,
  type TextNode,
} from '@/domain/board';
import { newId } from '@/lib/ids';
import { nowIso } from '@/lib/format';
import { rankAfterAll, rankBetween } from '@/lib/ranks';

/**
 * Constructors for every well-formed shape in the document. Everything is
 * optional except the fields a node cannot exist without, and `userId` is an
 * alias for `updatedBy` so callers can pass identity without repeating it.
 */
type Init<T> = Partial<Omit<T, 'kind'>> & { userId?: string };

function baseFields(kind: NodeKind, init: Init<NodeBase>): NodeBase {
  const created = init.createdAt ?? nowIso();
  return {
    id: init.id ?? newId(),
    kind,
    position: init.position ? { ...init.position } : { x: 0, y: 0 },
    size: init.size ? { ...init.size } : { ...DEFAULT_NODE_SIZE[kind] },
    z: init.z ?? 0,
    color: init.color ?? null,
    createdAt: created,
    updatedAt: init.updatedAt ?? created,
    updatedBy: init.updatedBy ?? init.userId ?? '',
    locked: init.locked ?? false,
  };
}

export function makeCard(init: Init<CardNode> = {}): CardNode {
  return {
    ...baseFields('card', init),
    kind: 'card',
    title: init.title ?? 'New card',
    body: init.body ?? '',
    checklist: init.checklist ? init.checklist.map((item) => ({ ...item })) : [],
    statusId: init.statusId ?? null,
    rank: init.rank ?? rankBetween(null, null),
    labelIds: init.labelIds ? [...init.labelIds] : [],
    coverMediaId: init.coverMediaId ?? null,
    dueDate: init.dueDate ?? null,
    collapsed: init.collapsed ?? false,
  };
}

export function makeNote(init: Init<NoteNode> = {}): NoteNode {
  return {
    ...baseFields('note', init),
    kind: 'note',
    color: init.color ?? 'straw',
    text: init.text ?? '',
  };
}

/** Fits an image node to its natural aspect ratio, long edge capped at 320 px. */
function imageSize(natural: { w: number; h: number }): { w: number; h: number } {
  const cap = DEFAULT_NODE_SIZE.image.w;
  const w = natural.w > 0 ? natural.w : cap;
  const h = natural.h > 0 ? natural.h : DEFAULT_NODE_SIZE.image.h;
  const scale = Math.min(1, cap / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function makeImageNode(
  init: Init<ImageNode> & { mediaId: Id; naturalSize: { w: number; h: number } },
): ImageNode {
  const natural = { ...init.naturalSize };
  return {
    ...baseFields('image', { ...init, size: init.size ?? imageSize(natural) }),
    kind: 'image',
    mediaId: init.mediaId,
    naturalSize: natural,
    caption: init.caption ?? null,
    fit: init.fit ?? 'contain',
  };
}

export function makeBoardLink(init: Init<BoardLinkNode> & { targetBoardId: Id }): BoardLinkNode {
  return {
    ...baseFields('boardLink', init),
    kind: 'boardLink',
    targetBoardId: init.targetBoardId,
    cachedTitle: init.cachedTitle ?? 'Board',
    cachedCounts: init.cachedCounts ? { ...init.cachedCounts } : null,
  };
}

export function makeGroup(init: Init<GroupNode> = {}): GroupNode {
  return {
    ...baseFields('group', init),
    kind: 'group',
    z: init.z ?? -1, // frames paint behind the nodes they hold
    title: init.title ?? 'Group',
    padding: init.padding ?? 24,
  };
}

/**
 * Free text on the canvas. It starts empty and left-aligned: the node is
 * created by clicking the board, and the caret has to land somewhere.
 */
export function makeText(init: Init<TextNode> = {}): TextNode {
  return {
    ...baseFields('text', init),
    kind: 'text',
    text: init.text ?? '',
    fontSize: init.fontSize ?? DEFAULT_TEXT_SIZE,
    align: init.align ?? 'left',
    weight: init.weight ?? 'regular',
  };
}

/** A draw.io shape. `fill`/`stroke` default to null — outline only, in --line-strong. */
export function makeShape(init: Init<ShapeNode> & { shape: ShapeKind }): ShapeNode {
  return {
    ...baseFields('shape', init),
    kind: 'shape',
    shape: init.shape,
    label: init.label ?? '',
    fill: init.fill ?? null,
    stroke: init.stroke ?? null,
  };
}

export function makeEdge(init: Init<Edge> & { source: Id; target: Id }): Edge {
  return {
    id: init.id ?? newId(),
    source: init.source,
    sourceHandle: init.sourceHandle ?? 'right',
    target: init.target,
    targetHandle: init.targetHandle ?? 'left',
    semantic: init.semantic ?? 'relates',
    label: init.label ?? null,
    routing: init.routing ?? 'bezier',
    color: init.color ?? null,
    updatedAt: init.updatedAt ?? nowIso(),
  };
}

export function makeChecklistItem(init: Partial<ChecklistItem> & { text?: string } = {}): ChecklistItem {
  return {
    id: init.id ?? newId(),
    text: init.text ?? '',
    done: init.done ?? false,
    rank: init.rank ?? rankBetween(null, null),
  };
}

export function makeStatus(init: Partial<StatusDef> & { name: string }): StatusDef {
  return {
    id: init.id ?? newId(),
    name: init.name,
    color: init.color ?? 'slate',
    order: init.order ?? 0,
    isDone: init.isDone ?? false,
  };
}

export function makeLabel(init: Partial<LabelDef> & { name: string }): LabelDef {
  return {
    id: init.id ?? newId(),
    name: init.name,
    color: init.color ?? 'slate',
  };
}

/** Idea → Planned → Building → Testing → Done (spec 7.4). */
export function makeDefaultStatuses(): StatusDef[] {
  return DEFAULT_STATUS_NAMES.map((s, index) =>
    makeStatus({ name: s.name, color: s.color, order: index, isDone: s.isDone }),
  );
}

export function makeBoard(init: {
  title: string;
  ownerId: string;
  id?: Id;
  parentBoardId?: Id | null;
  icon?: string | null;
  statuses?: StatusDef[];
}): BoardDoc {
  const created = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: init.id ?? newId(),
    parentBoardId: init.parentBoardId ?? null,
    title: init.title,
    icon: init.icon ?? null,
    createdAt: created,
    updatedAt: created,
    deletedAt: null,
    acl: { ownerId: init.ownerId, editorIds: [], viewerIds: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
    statuses: init.statuses ?? makeDefaultStatuses(),
    labels: [],
    nodes: [],
    edges: [],
    media: [],
  };
}

/** The next rank after every card already in `statusId`'s column. */
export function nextCardRank(cards: CardNode[], statusId: Id | null): string {
  return rankAfterAll(cards.filter((c) => c.statusId === statusId).map((c) => c.rank));
}
