/**
 * Factory for a brand-new board document.
 *
 * A new board is never empty of structure: it arrives with the five Swedish
 * statuses from the shared contract so the kanban view has columns and the
 * progress rollup has something to count on the first card.
 */

import { ulid } from 'ulid';
import type { BoardDoc, Id, StatusDef, Viewport } from '../../../src/domain/board.js';
import { DEFAULT_STATUS_NAMES, SCHEMA_VERSION } from '../../../src/domain/board.js';

export const DEFAULT_BOARD_TITLE = 'Untitled board';

export const DEFAULT_VIEWPORT: Readonly<Viewport> = { x: 0, y: 0, zoom: 1 };

/** Idea → Planned → Building → Testing → Done, with fresh ids. */
function defaultStatuses(): StatusDef[] {
  return DEFAULT_STATUS_NAMES.map((s, i) => ({
    id: ulid(),
    name: s.name,
    color: s.color,
    order: i,
    isDone: s.isDone,
  }));
}

export function newBoardDoc(title: string, parentBoardId: Id | null, ownerId: string): BoardDoc {
  const now = new Date().toISOString();
  const clean = title.trim();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: ulid(),
    parentBoardId,
    title: clean.length > 0 ? clean : DEFAULT_BOARD_TITLE,
    icon: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    acl: { ownerId, editorIds: [], viewerIds: [] },
    viewport: { ...DEFAULT_VIEWPORT },
    statuses: defaultStatuses(),
    labels: [],
    nodes: [],
    edges: [],
    media: [],
  };
}
