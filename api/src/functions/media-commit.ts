/**
 * `POST /api/media/commit` — confirm an upload and hand back its `MediaRef`.
 *
 * The upload itself went browser-to-blob, so this is the only moment the API
 * can check that what the client says it uploaded is actually there. The blob
 * is HEADed: a missing one is a 409 (the client is describing an image that
 * does not exist), and the stored length — not the declared one — is what ends
 * up in the document, because the blob is the source of truth about itself.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { MediaRef } from '../../../src/domain/board.js';
import { MAX_MEDIA_BYTES } from '../../../src/domain/board.js';
import { ApiError, PayloadTooLargeError } from '../domain/errors.js';
import type { MediaCommitResponse } from '../domain/types.js';
import { parseMediaCommitRequest } from '../domain/validate.js';
import { getBoardStore, getMediaStore } from '../stores/index.js';
import { readJson, requireBoard, requirePrincipal } from './_shared/context.js';
import { json, withHandler } from './_shared/respond.js';

/**
 * 409: the upload the client is committing is not in storage, or is not the
 * image it claims. Retrying the same request will not help — the upload has to
 * happen again — which is what separates this from a 400.
 */
class UploadMismatchError extends ApiError {
  constructor(message: string) {
    super(409, 'precondition_failed', message);
  }
}

/** Blob length may differ slightly from what the browser measured; not by much. */
function sizeMatches(actual: number, declared: number): boolean {
  return Math.abs(actual - declared) <= Math.max(1024, declared * 0.05);
}

app.http('media-commit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'media/commit',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const input = parseMediaCommitRequest(await readJson(request));

    await requireBoard(getBoardStore(), input.boardId, principal, 'write');

    const media = getMediaStore();
    const paths = media.mediaPaths(input.boardId, input.mediaId, input.contentType);

    const head = await media.head(paths.blobPath);
    if (!head) {
      throw new UploadMismatchError('That image never finished uploading. Try adding it again.');
    }
    if (head.bytes > MAX_MEDIA_BYTES) {
      throw new PayloadTooLargeError('That image is larger than the 10 MB limit.');
    }
    if (!sizeMatches(head.bytes, input.bytes)) {
      throw new UploadMismatchError(
        'The uploaded image does not match what was sent. Try adding it again.',
      );
    }

    const mediaRef: MediaRef = {
      id: input.mediaId,
      blobPath: paths.blobPath,
      thumbPath: paths.thumbPath,
      contentType: input.contentType,
      bytes: head.bytes,
      width: input.width,
      height: input.height,
      uploadedAt: new Date().toISOString(),
      uploadedBy: principal.userId,
    };

    const body: MediaCommitResponse = { mediaRef };
    return json(200, body);
  }),
});
