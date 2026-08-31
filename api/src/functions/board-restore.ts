/**
 * `POST /api/boards/{id}/restore` — put a restore point back.
 *
 * The document as it stands is snapshotted first, so restoring is itself
 * undoable: a mis-click costs one more entry in the list, never the current
 * board. Identity and access travel with the *board*, not with the snapshot,
 * so `id`, `createdAt` and `acl` are carried over from the live document —
 * restoring content must never roll back who may open it.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { BoardDoc } from '../../../src/domain/board.js';
import { NotFoundError } from '../domain/errors.js';
import type { BoardResponse } from '../domain/types.js';
import { parseRestoreRequest } from '../domain/validate.js';
import { getBoardStore } from '../stores/index.js';
import { readJson, requireBoard, requireBoardId, requirePrincipal } from './_shared/context.js';
import { json, withHandler } from './_shared/respond.js';

app.http('board-restore', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'boards/{id}/restore',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const id = requireBoardId(request);

    const store = getBoardStore();
    const current = await requireBoard(store, id, principal, 'write');
    const { snapshotName } = parseRestoreRequest(await readJson(request));

    const snapshot = await store.readSnapshot(id, snapshotName);
    if (!snapshot) throw new NotFoundError('That restore point no longer exists.');

    await store.snapshot(id);

    const doc: BoardDoc = {
      ...snapshot,
      id: current.doc.id,
      createdAt: current.doc.createdAt,
      acl: current.doc.acl,
      updatedAt: new Date().toISOString(),
    };

    const { etag } = await store.put(id, doc, current.etag);

    const body: BoardResponse = { doc, etag };
    return json(200, body, { ETag: etag });
  }),
});
