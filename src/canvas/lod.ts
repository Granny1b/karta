import type { Lod } from '@/lib/lod';

/**
 * The level of detail a node's *content* is drawn at, which is not always the
 * one the camera asks for: a collapsed card renders title-only wherever text is
 * drawn (spec 5.2). The camera's own level still drives the root class, so the
 * handles and their hover affordance keep behaving as spec 7.3 describes.
 *
 * Clamping only from `full`/`compact` keeps the `block` rectangle below zoom
 * 0.25 — a collapsed card must not become *more* detailed as it shrinks.
 */
export function contentLod(lod: Lod, collapsed: boolean): Lod {
  if (!collapsed) return lod;
  return lod === 'full' || lod === 'compact' ? 'title' : lod;
}
