/**
 * `GET /api/boards/{id}` — the full document.
 *
 * The store migrates whatever is on disk up to the current schema version
 * before it gets here, so a handler only ever sees a current `BoardDoc`. The
 * ETag goes back both as a header and in the body: the client holds it for the
 * `If-Match` guard on the next save (spec 6.1).
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { BoardResponse } from '../domain/types.js';
import { getBoardStore } from '../stores/index.js';
import { requireBoard, requireBoardId, requirePrincipal } from './_shared/context.js';
import { json, withHandler } from './_shared/respond.js';

app.http('board-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'boards/{id}',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const id = requireBoardId(request);

    const { doc, etag } = await requireBoard(getBoardStore(), id, principal, 'read');

    const body: BoardResponse = { doc, etag };
    return json(200, body, { ETag: etag });
  }),
});
