/**
 * `GET /api/media/read-token` — one container-scoped read SAS, 60-minute TTL
 * (spec 6.3).
 *
 * The client holds a single token for the whole tab and refreshes it at the
 * 50-minute mark. Blob names are immutable, so between refreshes every repeat
 * view is served from the browser cache and the storage account sees nothing.
 *
 * `baseUrl` is the blob endpoint with no query attached. A `MediaRef.blobPath`
 * is container-inclusive (`media/{boardId}/{mediaId}.webp`), so an image URL is
 * `${baseUrl}/${blobPath}?${query}` — the container must not appear twice.
 */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { Iso } from '../../../src/domain/board.js';
import type { ReadTokenResponse } from '../domain/types.js';
import { getMediaStore } from '../stores/index.js';
import { READ_SAS_TTL_MINUTES } from '../stores/types.js';
import { requirePrincipal } from './_shared/context.js';
import { json, withHandler } from './_shared/respond.js';

interface ReadTokenBody extends ReadTokenResponse {
  baseUrl: string;
}

/** Read the real expiry out of the signature rather than assuming the TTL. */
function expiryOf(query: string): Iso | null {
  const se = new URLSearchParams(query).get('se');
  if (!se) return null;
  const at = Date.parse(se);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

app.http('media-read-token', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'media/read-token',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    requirePrincipal(request);

    const sas = await getMediaStore().mintReadSas();
    const mark = sas.indexOf('?');
    const baseUrl = mark >= 0 ? sas.slice(0, mark) : sas;
    const query = mark >= 0 ? sas.slice(mark + 1) : '';

    const body: ReadTokenBody = {
      sas,
      baseUrl,
      expiresAt:
        expiryOf(query) ??
        new Date(Date.now() + READ_SAS_TTL_MINUTES * 60_000).toISOString(),
    };

    return json(200, body);
  }),
});
