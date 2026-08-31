/**
 * `GET /api/boards` — the board index (spec 5.4), filtered to what the caller
 * may see.
 *
 * `BoardSummary` carries `ownerId` and nothing else about access, so the
 * filter here is ownership: one blob read, no fan-out. A board shared with an
 * editor is still reachable by its link — `GET /api/boards/{id}` runs the real
 * ACL check — it simply does not appear in their tree. When sharing becomes a
 * first-class feature (spec 6.4, phase 5), the fix is to carry the ACL ids in
 * the summary and widen the predicate here; reading every board document to
 * answer this route would defeat the point of having an index at all.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { BoardIndex } from '@domain/board';
import { recomputeChildCounts } from '../domain/index-doc';
import { getBoardStore } from '../stores';
import { requirePrincipal } from './_shared/context';
import { json, withHandler } from './_shared/respond';

app.http('boards-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'boards',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requirePrincipal(request);
    const index = await getBoardStore().getIndex();

    const visible: BoardIndex = {
      ...index,
      boards: index.boards.filter((board) => board.ownerId === principal.userId),
    };

    // Child counts are recomputed over the visible set so the sidebar never
    // promises a nested board the caller cannot open.
    return json(200, recomputeChildCounts(visible));
  }),
});
