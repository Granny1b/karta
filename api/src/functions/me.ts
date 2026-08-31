/** `GET /api/me` — identity and roles, straight from `x-ms-client-principal`. */

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { toMe } from '../auth/principal';
import { requirePrincipal } from './_shared/context';
import { json, withHandler } from './_shared/respond';

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: withHandler(async (request: HttpRequest): Promise<HttpResponseInit> => {
    return json(200, toMe(requirePrincipal(request)));
  }),
});
