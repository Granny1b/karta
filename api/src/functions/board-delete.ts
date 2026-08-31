/**
 * `DELETE /api/boards/{id}` — soft delete.
 *
 * The blob is not touched: `deletedAt` is stamped and the document is written
 * back, which also refreshes the index entry so the board drops out of the
 * tree. Undelete is therefore an ordinary save, and blob soft delete (14 days,
 * spec 4.1) remains the backstop under that.
 *
 * Deleting a whole board is an owner action — an editor may change what is on
 * a board, not whether it exists.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { BoardDoc } from '@domain/board';
import { assertOwner } from '../auth/acl';
import { getBoardStore } from '../stores';
import { requireBoard, requireBoardId, requirePrincipal } from './_shared/context';
import { noContent, withHandler } from './_shared/respond';

app.http('board-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'boards/{id}',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const id = requireBoardId(request);

    const store = getBoardStore();
    const { doc, etag } = await requireBoard(store, id, principal, 'write');
    assertOwner(doc, principal.userId);

    // Already gone: answer the same way, so a retry after a dropped response
    // is not an error.
    if (doc.deletedAt !== null) return noContent();

    const now = new Date().toISOString();
    const deleted: BoardDoc = { ...doc, deletedAt: now, updatedAt: now };
    await store.put(id, deleted, etag);

    return noContent();
  }),
});
