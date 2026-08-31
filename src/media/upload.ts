/**
 * The upload half of the media flow (spec 6.2).
 *
 * The browser talks to blob storage directly with a five-minute, blob-scoped
 * SAS: the Function mints the URL and confirms the result, but never sees the
 * bytes. That is what keeps uploads clear of the 30 MB Static Web Apps request
 * limit and of the egress that would otherwise show up on the bill.
 */

import { MAX_MEDIA_BYTES, type Id, type MediaRef } from '@/domain/board';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { processImage } from '@/media/downscale';
import { queueOrphans } from '@/media/orphans';

/** Blob names are content-addressed and never rewritten, so a year is safe. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CONTENT_TYPE = 'image/webp';

async function putBlob(url: string, body: Blob, what: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-blob-content-type': CONTENT_TYPE,
        'cache-control': CACHE_CONTROL,
      },
      body,
    });
  } catch {
    throw new Error(`Could not upload the ${what}. Check your connection and try again.`);
  }
  if (!res.ok) {
    throw new Error(`Could not upload the ${what} (${res.status}).`);
  }
}

/**
 * Downscale, encode, upload both sizes, then commit. The returned `MediaRef`
 * is what belongs in `doc.media`; the caller adds it through
 * `useBoardStore.addMedia` and points a node at it.
 */
export async function processAndUploadImage(file: Blob, boardId: Id): Promise<MediaRef> {
  if (file.size === 0) {
    throw new Error('That file is empty.');
  }
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(
      `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_MEDIA_BYTES)} — ` +
        'shrink it or take a smaller screenshot.',
    );
  }
  if (file.type.length > 0 && !file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  const processed = await processImage(file);
  const target = await api.mediaUploadUrl({
    boardId,
    contentType: CONTENT_TYPE,
    bytes: processed.full.size,
  });

  await Promise.all([
    putBlob(target.uploadUrl, processed.full, 'image'),
    putBlob(target.thumbUploadUrl, processed.thumb, 'thumbnail'),
  ]);

  try {
    const { mediaRef } = await api.mediaCommit({
      boardId,
      mediaId: target.mediaId,
      width: processed.width,
      height: processed.height,
      bytes: processed.full.size,
      contentType: CONTENT_TYPE,
    });
    return mediaRef;
  } catch (err) {
    // The bytes are in storage but no document will ever reference them.
    // Queue them with the orphans so the next save cleans up (spec 5.5).
    queueOrphans([target.blobPath, target.thumbPath]);
    throw err;
  }
}
