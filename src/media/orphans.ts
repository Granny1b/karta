/**
 * Orphaned media (spec 5.5).
 *
 * Media metadata lives in the board document, so deleting an image node is the
 * only signal that its blobs are no longer wanted. The paths are queued on the
 * store and travel with the next `PUT /api/boards/{id}`, which deletes them
 * after the document write succeeds — never before, so a failed save can never
 * leave a document pointing at bytes that are gone.
 */

import type { BoardDoc, BoardNode, Id, MediaRef } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';

/**
 * Every media id something still points at: image nodes, card covers, and any
 * id mentioned in card or note markdown (an embedded `![](media/…/{id}.webp)`
 * is a reference the node graph cannot see).
 */
export function referencedMediaIds(
  nodes: readonly BoardNode[],
  media: readonly MediaRef[],
): Set<Id> {
  const used = new Set<Id>();
  const prose: string[] = [];

  for (const node of nodes) {
    if (node.kind === 'image') used.add(node.mediaId);
    if (node.kind === 'card') {
      if (node.coverMediaId) used.add(node.coverMediaId);
      if (node.body.length > 0) prose.push(node.body);
    }
    if (node.kind === 'note' && node.text.length > 0) prose.push(node.text);
  }

  if (prose.length > 0) {
    const text = prose.join('\n');
    for (const ref of media) if (!used.has(ref.id) && text.includes(ref.id)) used.add(ref.id);
  }

  return used;
}

/** The blob paths behind a set of refs, blanks removed and deduplicated. */
export function orphanPathsFor(refs: readonly MediaRef[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    for (const path of [ref.blobPath, ref.thumbPath]) {
      if (typeof path !== 'string' || path.length === 0 || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

/**
 * What removing `removedIds` would release: the refs to drop from
 * `doc.media` and the blob paths to delete. Pure — the caller decides when to
 * apply it, so an undoable edit can be computed before it is committed.
 */
export function releasedByRemoving(
  doc: BoardDoc,
  removedIds: Iterable<Id>,
): { keep: MediaRef[]; released: MediaRef[]; orphanPaths: string[] } {
  const doomed = new Set<Id>(removedIds);
  const survivors = doc.nodes.filter((node) => !doomed.has(node.id));
  if (survivors.length === doc.nodes.length) {
    return { keep: doc.media, released: [], orphanPaths: [] };
  }

  const used = referencedMediaIds(survivors, doc.media);
  const keep: MediaRef[] = [];
  const released: MediaRef[] = [];
  for (const ref of doc.media) (used.has(ref.id) ? keep : released).push(ref);

  return { keep, released, orphanPaths: orphanPathsFor(released) };
}

/**
 * Queue blob paths for deletion on the next save. Deduplicated against what is
 * already queued, so a repeated delete/undo cycle cannot grow the list.
 */
export function queueOrphans(paths: readonly string[]): void {
  if (paths.length === 0) return;
  const store = useBoardStore.getState();
  const seen = new Set(store.pendingOrphans);
  const added = paths.filter((path) => {
    if (typeof path !== 'string' || path.length === 0 || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
  if (added.length === 0) return;
  useBoardStore.setState({ pendingOrphans: [...store.pendingOrphans, ...added] });
}
