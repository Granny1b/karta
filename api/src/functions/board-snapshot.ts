/**
 * `POST /api/boards/{id}/snapshot` — copy the current document into
 * `snapshots/{boardId}/{iso}.json`.
 *
 * Server-side copy of one small blob: no payload crosses the Function, and the
 * restore point is a plain document that can be read back by hand if it ever
 * has to be.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { SnapshotResponse } from '../domain/types';
import { getBoardStore } from '../stores';
import { requireBoard, requireBoardId, requirePrincipal } from './_shared/context';
import { json, withHandler } from './_shared/respond';

app.http('board-snapshot', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'boards/{id}/snapshot',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const id = requireBoardId(request);

    const store = getBoardStore();
    // A restore point is written on the caller's behalf and consumes storage,
    // so it takes write access rather than read.
    await requireBoard(store, id, principal, 'write');

    const snapshotName = await store.snapshot(id);

    const body: SnapshotResponse = { snapshotName };
    return json(201, body);
  }),
});
