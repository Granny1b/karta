/**
 * Level of detail for canvas rendering (spec 7.3).
 *
 * | zoom      | lod       |
 * |-----------|-----------|
 * | >= 0.8    | `full`    |
 * | 0.4–0.8   | `compact` |
 * | 0.25–0.4  | `title`   |
 * | < 0.25    | `block`   |
 */
export type Lod = 'full' | 'compact' | 'title' | 'block';

export function lodForZoom(zoom: number): Lod {
  if (!Number.isFinite(zoom)) return 'full';
  if (zoom >= 0.8) return 'full';
  if (zoom >= 0.4) return 'compact';
  if (zoom >= 0.25) return 'title';
  return 'block';
}
