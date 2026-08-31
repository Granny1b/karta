/**
 * Static Web Apps injects the signed-in identity as a base64 JSON header. No
 * token is verified here and none should be: the platform strips any inbound
 * `x-ms-client-principal` from the public edge and re-adds its own, so the
 * header is trustworthy exactly as far as the platform is.
 *
 * Nothing in this module throws. A malformed header is an anonymous request,
 * not a 500.
 */

import type { Me } from '@domain/board';

export interface ClientPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

export const PRINCIPAL_HEADER = 'x-ms-client-principal';

/** Anything with the `Headers`-shaped `get` — `HttpRequest.headers` qualifies. */
export interface HeaderLike {
  get(name: string): string | null | undefined;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Decode the base64 JSON header. Returns null when absent or unusable. */
export function parsePrincipal(header: string | null | undefined): ClientPrincipal | null {
  if (typeof header !== 'string' || header.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;

  const userId = asString(raw['userId']);
  if (userId.length === 0) return null;

  const roles = Array.isArray(raw['userRoles'])
    ? raw['userRoles'].filter((r): r is string => typeof r === 'string')
    : [];

  return {
    userId,
    userDetails: asString(raw['userDetails']),
    identityProvider: asString(raw['identityProvider']),
    userRoles: roles,
  };
}

/** Convenience for handlers: pull the principal straight off a request. */
export function readPrincipal(headers: HeaderLike): ClientPrincipal | null {
  return parsePrincipal(headers.get(PRINCIPAL_HEADER));
}

/** The body of `GET /api/me`. */
export function toMe(principal: ClientPrincipal): Me {
  return {
    userId: principal.userId,
    userDetails: principal.userDetails,
    identityProvider: principal.identityProvider,
    userRoles: [...principal.userRoles],
  };
}
