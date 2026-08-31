/**
 * The canvas clipboard (spec 9, `Ctrl+V` — "paste image or card").
 *
 * Nodes are held in memory rather than serialised onto the system clipboard: a
 * custom MIME type is not readable on paste in every browser, and a board's
 * nodes are not something another application can do anything with. What does
 * go onto the clipboard is a short marker carrying a one-off token, so a paste
 * is recognised as ours only when it is the copy this session made — anything
 * else the user copied in between falls through to the image handler.
 */

import type { BoardDoc, BoardNode, Edge, Id } from '@/domain/board';
import { newId } from '@/lib/ids';

export interface ClipboardPayload {
  /** The board the copy came from; pasting into another board is still allowed. */
  boardId: Id;
  nodes: BoardNode[];
  edges: Edge[];
}

const MARKER_PREFIX = 'karta/nodes:';

let held: { token: string; payload: ClipboardPayload } | null = null;

/** The text a copy writes to `text/plain`. */
export function clipboardMarker(token: string): string {
  return `${MARKER_PREFIX}${token}`;
}

/** The token inside a marker, or `null` when the text is not one of ours. */
export function markerToken(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(MARKER_PREFIX)) return null;
  const token = trimmed.slice(MARKER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * The nodes to copy, plus the edges that ran between them. Document objects are
 * immutable snapshots under immer, so they are held as they are.
 */
export function collectForClipboard(doc: BoardDoc, ids: readonly Id[]): ClipboardPayload | null {
  const wanted = new Set(ids);
  const nodes = doc.nodes.filter((node) => wanted.has(node.id));
  if (nodes.length === 0) return null;

  const kept = new Set(nodes.map((node) => node.id));
  const edges = doc.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
  return { boardId: doc.id, nodes, edges };
}

/** Takes the payload and returns the marker text to put on the clipboard. */
export function holdForClipboard(payload: ClipboardPayload): string {
  const token = newId();
  held = { token, payload };
  return clipboardMarker(token);
}

/** The payload a marker refers to, or `null` when this is not our copy. */
export function payloadForMarker(text: string | null | undefined): ClipboardPayload | null {
  const token = markerToken(text);
  if (token === null || held === null || held.token !== token) return null;
  return held.payload;
}

/** Test seam: forgets whatever was copied. */
export function forgetClipboard(): void {
  held = null;
}
