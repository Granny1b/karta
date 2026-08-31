/**
 * Request plumbing shared by every handler: who is calling, which board, and
 * what they sent. Each function throws a typed error, so a handler reads as a
 * straight line and `withHandler` turns any failure into the right status.
 */

import type { HttpRequest } from '@azure/functions';
import type { BoardDoc, Id } from '../../../../src/domain/board.js';
import { assertCanRead, assertCanWrite, assertMember } from '../../auth/acl.js';
import type { ClientPrincipal } from '../../auth/principal.js';
import { readPrincipal } from '../../auth/principal.js';
import { BadRequestError, NotFoundError } from '../../domain/errors.js';
import { isUlid } from '../../domain/validate.js';
import type { BoardStore } from '../../stores/types.js';

/**
 * Static Web Apps already gates `/api/*` on the `member` role, but the header
 * is re-checked here: a misconfigured route table must not silently open the
 * API. Missing principal -> 401, missing role -> 403.
 */
export function requirePrincipal(request: HttpRequest): ClientPrincipal {
  return assertMember(readPrincipal(request.headers));
}

/** The `{id}` route segment, validated before it can reach a blob name. */
export function requireBoardId(request: HttpRequest): Id {
  const id = request.params['id'];
  if (!isUlid(id)) throw new BadRequestError('That is not a valid board id.');
  return id;
}

/** The ETag the client held since load. Spec 6.1 makes it mandatory on a write. */
export function requireIfMatch(request: HttpRequest): string {
  const value = request.headers.get('if-match')?.trim();
  if (!value) {
    throw new BadRequestError(
      'This save needs an If-Match header. Reload the board and try again.',
    );
  }
  return value;
}

/** Parse a JSON body, turning a malformed one into a 400 rather than a 500. */
export async function readJson(request: HttpRequest): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new BadRequestError('The request body is not valid JSON.');
  }
}

/**
 * Load a board and apply the second auth gate (spec 6.6): the `member` role
 * gets you in the door, the board's own ACL decides which boards.
 *
 * Soft-deleted boards still resolve — they have to, or they could never be
 * restored — and it is the client that hides them from the tree.
 */
export async function requireBoard(
  store: BoardStore,
  id: Id,
  principal: ClientPrincipal,
  access: 'read' | 'write',
): Promise<{ doc: BoardDoc; etag: string }> {
  const found = await store.get(id);
  if (!found) throw new NotFoundError('That board does not exist.');

  if (access === 'write') assertCanWrite(found.doc, principal.userId);
  else assertCanRead(found.doc, principal.userId);

  return found;
}
