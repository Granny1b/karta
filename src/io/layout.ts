/**
 * Grid geometry for imported content.
 *
 * Cards that arrive without a position are laid out in a tidy grid below
 * whatever is already on the board. The exporter runs the same geometry
 * backwards: a card sitting exactly in its grid slot is written out without a
 * position, so a board built by import round-trips to the same clean JSON.
 */

import type { BoardNode } from '@/domain/board';

export const COLUMN_PITCH = 280;
export const ROW_PITCH = 180;
/** Clear air between existing content and an imported block. */
export const BLOCK_GAP = 80;
export const MAX_COLUMNS = 12;

/** A near-square grid, never wider than twelve columns. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  return Math.min(MAX_COLUMNS, Math.max(1, Math.round(Math.sqrt(count))));
}

/** Top-left of the imported block: left-aligned with, and below, what exists. */
export function layoutOrigin(nodes: readonly BoardNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };

  let left = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    left = Math.min(left, node.position.x);
    bottom = Math.max(bottom, node.position.y + node.size.h);
  }
  if (!Number.isFinite(left) || !Number.isFinite(bottom)) return { x: 0, y: 0 };
  return { x: Math.round(left), y: Math.round(bottom + BLOCK_GAP) };
}

export function gridSlot(
  origin: { x: number; y: number },
  columns: number,
  index: number,
): { x: number; y: number } {
  const safe = Math.max(1, columns);
  return {
    x: origin.x + (index % safe) * COLUMN_PITCH,
    y: origin.y + Math.floor(index / safe) * ROW_PITCH,
  };
}
