/**
 * Client-side image processing (spec 7.3).
 *
 * Everything happens in the browser: the file is decoded, drawn to a canvas at
 * a bounded size and re-encoded to WebP, then a thumbnail is produced the same
 * way. A 2 MB screenshot typically lands under 250 KB, which is what keeps the
 * storage bill at zero — and there is no server-side image library to maintain.
 */

/** Long edge of the stored image. */
const MAX_EDGE = 2560;
/** Long edge of the thumbnail used below zoom 0.8 and in the cover picker. */
const THUMB_EDGE = 480;
const QUALITY = 0.82;
const OUTPUT_TYPE = 'image/webp';

export interface ProcessedImage {
  /** Full-size WebP, long edge ≤ 2560 px. */
  full: Blob;
  /** Thumbnail WebP, long edge ≤ 480 px. */
  thumb: Blob;
  /** Dimensions of `full` — what an `ImageNode` stores as `naturalSize`. */
  width: number;
  height: number;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

const UNREADABLE = 'That file is not an image this browser can read.';

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // Some browsers refuse blobs they can nonetheless render in an <img>.
    }
  }
  return decodeWithElement(file);
}

function decodeWithElement(file: Blob): Promise<Decoded> {
  return new Promise<Decoded>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (width === 0 || height === 0) {
        URL.revokeObjectURL(url);
        reject(new Error(UNREADABLE));
        return;
      }
      resolve({ source: img, width, height, release: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(UNREADABLE));
    };
    img.src = url;
  });
}

/** Scaled size for a long-edge cap. Never upscales. */
function fit(width: number, height: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('This browser could not encode the image.'));
      },
      OUTPUT_TYPE,
      QUALITY,
    );
  });
}

async function render(
  decoded: Decoded,
  edge: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fit(decoded.width, decoded.height, edge);

  let blob: Blob;
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not open a drawing surface.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, width, height);
    blob = await canvas.convertToBlob({ type: OUTPUT_TYPE, quality: QUALITY });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not open a drawing surface.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, width, height);
    blob = await encodeCanvas(canvas);
  }

  // A browser that cannot encode WebP silently hands back PNG, which would be
  // stored under a .webp name and served with the wrong content type.
  if (blob.type !== OUTPUT_TYPE) {
    throw new Error('This browser cannot save WebP images. Try Edge, Chrome, Firefox or Safari 14+.');
  }

  return { blob, width, height };
}

/**
 * Decode, downscale and re-encode. Both outputs are WebP; the thumbnail is
 * drawn from the original pixels rather than from the downscaled copy, so it
 * stays sharp.
 */
export async function processImage(file: Blob): Promise<ProcessedImage> {
  const decoded = await decode(file);
  try {
    const full = await render(decoded, MAX_EDGE);
    const thumb = await render(decoded, THUMB_EDGE);
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    decoded.release();
  }
}
