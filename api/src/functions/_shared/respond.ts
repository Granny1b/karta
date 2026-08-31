/**
 * The HTTP boundary: the one place a value becomes a status code.
 *
 * Handlers throw the typed errors from `domain/errors` and never build an
 * error response themselves, so the mapping from `PayloadTooLargeError` to a
 * 413 with the "split into a nested board" message lives here and nowhere
 * else. Anything thrown that is *not* an `ApiError` is a bug: it is logged in
 * full through the invocation context and answered with a bare 500.
 */

import type { HttpHandler, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ApiErrorCode } from '../../domain/errors.js';
import { isApiError, toHttpError } from '../../domain/errors.js';

/**
 * The wire shape of an error.
 *
 * `code` is for machines, `message` for people. `error` repeats the message
 * because clients commonly read that key first, and a user who breaks the size
 * budget must see the sentence telling them what to do — not the string
 * `payload_too_large`.
 */
export interface ErrorBody {
  error: string;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

/** Board documents and identity are per-user and change constantly. */
const NO_STORE = 'no-store';

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponseInit {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': NO_STORE,
      ...headers,
    },
    jsonBody: body,
  };
}

/** For a successful write with nothing worth returning. */
export function noContent(headers: Record<string, string> = {}): HttpResponseInit {
  return { status: 204, headers: { 'Cache-Control': NO_STORE, ...headers } };
}

/** Map a thrown value to its response. Never leaks internals for a non-`ApiError`. */
export function problem(err: unknown): HttpResponseInit {
  const { status, body } = toHttpError(err);
  const wire: ErrorBody = { error: body.message, code: body.error, message: body.message };
  if (body.details !== undefined) wire.details = body.details;
  return json(status, wire);
}

export type Handler = (
  request: HttpRequest,
  context: InvocationContext,
) => Promise<HttpResponseInit>;

/**
 * Wrap a handler so no throw escapes as a host-level 500 with a stack trace.
 * Expected failures (4xx) are logged as one line; anything else is logged with
 * the error object so it reaches Application Insights intact.
 */
export function withHandler(fn: Handler): HttpHandler {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      return await fn(request, context);
    } catch (err) {
      const response = problem(err);
      const status = response.status ?? 500;

      if (isApiError(err) && status < 500) {
        context.warn(`${request.method} ${request.url} -> ${status}: ${err.message}`);
      } else {
        context.error(`${request.method} ${request.url} -> ${status}`, err);
      }

      return response;
    }
  };
}
