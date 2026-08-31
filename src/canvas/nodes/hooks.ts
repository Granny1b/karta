import { useCallback } from 'react';
import { useStore, type OnResizeEnd } from '@xyflow/react';
import type { BoardNode, CardNode, Id } from '@/domain/board';
import { lodForZoom, type Lod } from '@/lib/lod';
import { useMediaUrl } from '@/media/mediaUrl';
import { useBoardStore } from '@/state/boardStore';
import { matchesFilter } from '@/state/selectors';
import { useUiStore } from '@/state/uiStore';
import { resizeGeometry } from '@/canvas/resize';

/** The level of detail for the current camera (spec 7.3). */
export function useLod(): Lod {
  return useStore((s) => lodForZoom(s.transform[2]));
}

/** A filtered-out card is dimmed, never hidden, so the layout cannot jump (spec 7.4). */
export function useCardDimmed(card: CardNode): boolean {
  return useUiStore((s) => s.filterActive() && !matchesFilter(card, s.filter));
}

/**
 * Commits a finished resize (spec 10, phase 1). React Flow keeps the live box
 * in flow state while the handle is dragged; the document hears about it once,
 * at the end of the gesture, so one resize is one undo entry — and it carries
 * the position too, because dragging a top or left handle moves the origin.
 */
export function useNodeResize(node: BoardNode): OnResizeEnd {
  const id = node.id;
  return useCallback<OnResizeEnd>(
    (_event, params) => {
      const store = useBoardStore.getState();
      const current = store.doc?.nodes.find((n) => n.id === id);
      if (!current) return;

      const next = resizeGeometry(current, params);
      if (!next) return;

      store.mutate('Resize node', (d) => {
        const target = d.nodes.find((n) => n.id === id);
        if (!target || target.locked) return;
        target.position = next.position;
        target.size = next.size;
      });
    },
    [id],
  );
}

/** A readable URL for a media id, or null while the read token is still coming. */
export function useMediaSrc(mediaId: Id | null, variant: 'full' | 'thumb'): string | null {
  const ref = useBoardStore((s) =>
    mediaId === null ? null : (s.doc?.media.find((m) => m.id === mediaId) ?? null),
  );
  const resolve = useMediaUrl();
  if (!ref) return null;
  return resolve(variant === 'thumb' ? ref.thumbPath : ref.blobPath);
}
