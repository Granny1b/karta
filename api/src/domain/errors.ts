/**
 * Typed errors shared by the domain and store layers.
 *
 * Every function handler wraps its body in a try/catch and funnels the caught
 * value through {@link toHttpError}, so a thrown `ApiError` anywhere below the
 * HTTP layer becomes the right status code without the handler knowing which
 * store or validator produced it. Anything that is *not* an `ApiError` is a
 * bug and deliberately degrades to a bare 500 with no internal detail leaked.
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'precondition_failed'
  | 'payload_too_large'
  | 'internal_error';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, 'bad_request', message, details);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Not signed in.') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'You do not have access to this board.') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found.') {
    super(404, 'not_found', message);
  }
}

/** ETag guard lost: the blob changed under us. Maps to HTTP 412. */
export class PreconditionFailedError extends ApiError {
  constructor(message = 'This board changed somewhere else.') {
    super(412, 'precondition_failed', message);
  }
}

/** Size budget breached — spec 5.6 hard stop. Maps to HTTP 413. */
export class PayloadTooLargeError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(413, 'payload_too_large', message, details);
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export interface HttpErrorBody {
  error: ApiErrorCode;
  message: string;
  details?: unknown;
}

export interface HttpErrorResponse {
  status: number;
  body: HttpErrorBody;
}

/** Single mapping point from a thrown value to an HTTP status + JSON body. */
export function toHttpError(err: unknown): HttpErrorResponse {
  if (isApiError(err)) {
    const body: HttpErrorBody = { error: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return { status: err.status, body };
  }
  return {
    status: 500,
    body: { error: 'internal_error', message: 'Something went wrong on the server.' },
  };
}
