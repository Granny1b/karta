/**
 * Two gates, in this order (spec 6.6):
 *
 *  1. The custom role `member` gets you in the door. Static Web Apps enforces
 *     it at the route level; {@link assertMember} enforces it again here so a
 *     misconfigured `staticwebapp.config.json` cannot quietly open the API.
 *  2. The board's own `acl` decides which boards. The owner always wins,
 *     editors write, viewers read.
 */

import type { BoardDoc } from '../../../src/domain/board.js';
import { ForbiddenError, UnauthorizedError } from '../domain/errors.js';
import type { ClientPrincipal } from './principal.js';

export const MEMBER_ROLE = 'member';

export function isOwner(doc: BoardDoc, userId: string): boolean {
  return doc.acl.ownerId === userId;
}

export function canWrite(doc: BoardDoc, userId: string): boolean {
  return isOwner(doc, userId) || doc.acl.editorIds.includes(userId);
}

export function canRead(doc: BoardDoc, userId: string): boolean {
  return canWrite(doc, userId) || doc.acl.viewerIds.includes(userId);
}

/**
 * Throws unless the caller is signed in and carries the `member` role.
 * Returns the principal so handlers can start with
 * `const principal = assertMember(readPrincipal(request.headers));`
 */
export function assertMember(principal: ClientPrincipal | null): ClientPrincipal {
  if (!principal) throw new UnauthorizedError();
  if (!principal.userRoles.includes(MEMBER_ROLE)) {
    throw new ForbiddenError('This account has not been invited to Karta.');
  }
  return principal;
}

export function assertCanRead(doc: BoardDoc, userId: string): void {
  if (!canRead(doc, userId)) {
    throw new ForbiddenError('You do not have access to this board.');
  }
}

export function assertCanWrite(doc: BoardDoc, userId: string): void {
  if (!canWrite(doc, userId)) {
    throw new ForbiddenError(
      canRead(doc, userId)
        ? 'You have read-only access to this board.'
        : 'You do not have access to this board.',
    );
  }
}

export function assertOwner(doc: BoardDoc, userId: string): void {
  if (!isOwner(doc, userId)) {
    throw new ForbiddenError('Only the owner of a board can do that.');
  }
}
