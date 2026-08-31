/**
 * `POST /api/boards` — create a board.
 *
 * The new document arrives seeded with the five default statuses, so the
 * kanban view has columns before the first card exists. The store writes the
 * document and then upserts the index entry.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { BoardResponse } from '../domain/types.js';
import { newBoardDoc } from '../domain/defaults.js';
import { parseCreateBoardRequest } from '../domain/validate.js';
import { getBoardStore } from '../stores/index.js';
import { readJson, requireBoard, requirePrincipal } from './_shared/context.js';
import { json, withHandler } from './_shared/respond.js';

app.http('boards-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'boards',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const input = parseCreateBoardRequest(await readJson(request));
    const store = getBoardStore();

    // Nesting under a board means writing to that board's subtree, so the
    // parent has to be one the caller can write — and one that exists.
    if (input.parentBoardId) {
      await requireBoard(store, input.parentBoardId, principal, 'write');
    }

    const doc = newBoardDoc(input.title, input.parentBoardId ?? null, principal.userId);
    const { etag } = await store.put(doc.id, doc, null);

    const body: BoardResponse = { doc, etag };
    return json(201, body, { ETag: etag, Location: `/api/boards/${doc.id}` });
  }),
});
