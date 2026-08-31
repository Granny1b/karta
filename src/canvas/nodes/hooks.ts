import { useStore } from '@xyflow/react';
import type { CardNode, Id } from '@/domain/board';
import { lodForZoom, type Lod } from '@/lib/lod';
import { useMediaUrl } from '@/media/mediaUrl';
import { useBoardStore } from '@/state/boardStore';
import { matchesFilter } from '@/state/selectors';
import { useUiStore } from '@/state/uiStore';

/** The level of detail for the current camera (spec 7.3). */
export function useLod(): Lod {
  return useStore((s) => lodForZoom(s.transform[2]));
}

/** A filtered-out card is dimmed, never hidden, so the layout cannot jump (spec 7.4). */
export function useCardDimmed(card: CardNode): boolean {
  return useUiStore((s) => s.filterActive() && !matchesFilter(card, s.filter));
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
