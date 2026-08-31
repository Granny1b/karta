/**
 * `POST /api/media/upload-url` — mint a write SAS (spec 6.2).
 *
 * The browser then PUTs the bytes straight to blob storage. That is what keeps
 * this inside the free tier: the 30 MB Static Web Apps request limit never
 * applies, the Function moves no payload, and there is no server-side image
 * library to maintain. The SAS is `cw` (create + write) on exactly two blob
 * names and lives five minutes, so a leaked URL can add one image and nothing
 * else.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { UploadTarget } from '@domain/board';
import { ulid } from 'ulid';
import { parseUploadUrlRequest } from '../domain/validate';
import { getBoardStore, getMediaStore } from '../stores';
import { readJson, requireBoard, requirePrincipal } from './_shared/context';
import { json, withHandler } from './_shared/respond';

app.http('media-upload-url', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'media/upload-url',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const input = parseUploadUrlRequest(await readJson(request));

    // The blob lands under the board's prefix, so minting the SAS is a write
    // to that board.
    await requireBoard(getBoardStore(), input.boardId, principal, 'write');

    const target: UploadTarget = await getMediaStore().mintUploadSas(
      input.boardId,
      ulid(),
      input.contentType,
    );

    return json(200, target);
  }),
});
