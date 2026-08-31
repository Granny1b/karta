/**
 * The API's view of the domain.
 *
 * Everything structural comes from the single shared contract in
 * `src/domain/board.ts` (aliased `@domain/board`) so the wire types can never
 * drift from what the frontend compiles against. Only request/response shapes
 * that exist purely at the HTTP boundary are declared here.
 */

export * from '@domain/board';

import type { BoardDoc, Id, Iso, MediaContentType, MediaRef, SnapshotRef } from '@domain/board';

/* ------------------------------------------------------------------ *
 * Boards
 * ------------------------------------------------------------------ */

/** `POST /api/boards` */
export interface CreateBoardRequest {
  title: string;
  parentBoardId?: Id | null;
}

/** `PUT /api/boards/{id}` — full replace, guarded by `If-Match`. */
export interface PutBoardRequest {
  doc: BoardDoc;
  /**
   * Blobs belonging to media the client dropped in this revision. Deleted
   * after the document write succeeds, never before — an orphan costs a
   * fraction of a cent, a blob deleted ahead of a failed write costs an image.
   */
  orphanBlobPaths?: string[];
}

/** Body of `GET /api/boards/{id}`, `POST /api/boards` and `POST /api/boards/{id}/restore`. */
export interface BoardResponse {
  doc: BoardDoc;
  etag: string;
}

/** Body of `PUT /api/boards/{id}`. */
export interface PutBoardResponse {
  etag: string;
  doc: BoardDoc;
  /** Present when the document is over the soft budget of spec 5.6. */
  warning?: string;
}

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

/** `POST /api/boards/{id}/snapshot` */
export interface SnapshotResponse {
  snapshotName: string;
}

/** `GET /api/boards/{id}/snapshots` */
export type ListSnapshotsResponse = SnapshotRef[];

/** `POST /api/boards/{id}/restore` */
export interface RestoreRequest {
  snapshotName: string;
}

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

/** `POST /api/media/upload-url` */
export interface UploadUrlRequest {
  boardId: Id;
  contentType: MediaContentType;
  bytes: number;
}

/** `POST /api/media/commit` */
export interface MediaCommitRequest {
  boardId: Id;
  mediaId: Id;
  width: number;
  height: number;
  bytes: number;
  contentType: MediaContentType;
}

export interface MediaCommitResponse {
  mediaRef: MediaRef;
}

/**
 * `GET /api/media/read-token`.
 *
 * `sas` is the storage account origin with the read SAS query appended, e.g.
 * `https://stkarta.blob.core.windows.net?sv=...&sig=...`. A `MediaRef.blobPath`
 * is container-inclusive (`media/{boardId}/{mediaId}.webp`), so the client
 * builds an image URL by splitting once on `?`:
 * `` `${origin}/${blobPath}?${query}` ``.
 */
export interface ReadTokenResponse {
  sas: string;
  expiresAt: Iso;
}
