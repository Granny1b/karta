/** `GET /api/boards/{id}/snapshots` — the restore points, newest first. */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { ListSnapshotsResponse } from '../domain/types';
import { getBoardStore } from '../stores';
import { requireBoard, requireBoardId, requirePrincipal } from './_shared/context';
import { json, withHandler } from './_shared/respond';

app.http('board-snapshots', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'boards/{id}/snapshots',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const id = requireBoardId(request);

    const store = getBoardStore();
    await requireBoard(store, id, principal, 'read');

    const body: ListSnapshotsResponse = await store.listSnapshots(id);
    return json(200, body);
  }),
});
