/**
 * `PUT /api/boards/{id}` — full replace, guarded by `If-Match` (spec 6.1).
 *
 * Three things are decided here and nowhere else:
 *
 *  - **Identity fields are server-owned.** `id`, `createdAt` and `acl` are
 *    taken from the stored document, so a client cannot rename a board into
 *    another one or promote itself to owner by editing the JSON it sends back.
 *  - **`updatedAt` is stamped server-side**, which keeps the document and its
 *    index entry telling the same story — the 20 s poll of spec 6.4 compares
 *    exactly those two values.
 *  - **Orphaned blobs are deleted after the write succeeds** (spec 5.5). An
 *    orphan that survives costs a fraction of a cent; a blob deleted ahead of
 *    a failed write costs the user an image.
 */

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { BoardDoc } from '@domain/board';
import { PayloadTooLargeError } from '../domain/errors';
import type { PutBoardResponse } from '../domain/types';
import { enforceSizeBudget, parsePutBoardRequest } from '../domain/validate';
import { getBoardStore, getMediaStore } from '../stores';
import {
  readJson,
  requireBoard,
  requireBoardId,
  requireIfMatch,
  requirePrincipal,
} from './_shared/context';
import { json, withHandler } from './_shared/respond';

app.http('board-put', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'boards/{id}',
  handler: withHandler(
    async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
      const principal = requirePrincipal(request);
      const id = requireBoardId(request);
      const ifMatch = requireIfMatch(request);

      const store = getBoardStore();
      const stored = await requireBoard(store, id, principal, 'write');
      const input = parsePutBoardRequest(await readJson(request), id);

      const doc: BoardDoc = {
        ...input.doc,
        id: stored.doc.id,
        createdAt: stored.doc.createdAt,
        acl: stored.doc.acl,
        updatedAt: new Date().toISOString(),
      };

      const budget = enforceSizeBudget(JSON.stringify(doc), doc);
      if (budget.level === 'reject') {
        throw new PayloadTooLargeError(budget.message ?? 'This board is too large to save.');
      }

      const { etag } = await store.put(id, doc, ifMatch);
      await deleteOrphans(input.orphanBlobPaths ?? [], doc, context);

      const body: PutBoardResponse = { etag, doc };
      if (budget.level === 'warn' && budget.message) body.warning = budget.message;
      return json(200, body, { ETag: etag });
    },
  ),
});

/**
 * Best effort, and never fatal: the document is already durable by the time
 * this runs, so a failed cleanup must not turn a successful save into an error
 * the user sees. Anything the saved document still points at is skipped — a
 * client bug should not be able to delete a live image.
 */
async function deleteOrphans(
  paths: string[],
  doc: BoardDoc,
  context: InvocationContext,
): Promise<void> {
  if (paths.length === 0) return;

  const live = new Set<string>();
  for (const ref of doc.media) {
    live.add(ref.blobPath);
    live.add(ref.thumbPath);
  }

  const removable = paths.filter((path) => !live.has(path));
  if (removable.length === 0) return;

  try {
    await getMediaStore().delete(removable);
  } catch (err) {
    context.warn(`Board ${doc.id} saved, but ${removable.length} orphaned blobs were not deleted`, err);
  }
}
