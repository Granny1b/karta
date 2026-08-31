/**
 * The migration seam (spec 6.5).
 *
 * Handlers depend on these interfaces, never on `@azure/storage-blob`. If the
 * size budget in 5.6 is ever breached in practice, a `CosmosBoardStore` is
 * written against the same two interfaces and nothing in the frontend or the
 * HTTP contract changes.
 */

import type {
  BoardDoc,
  BoardIndex,
  Id,
  MediaContentType,
  SnapshotRef,
  UploadTarget,
} from '@domain/board';

export type { SnapshotRef, UploadTarget };

export interface BoardStore {
  getIndex(): Promise<BoardIndex>;

  /** `null` when the board does not exist. */
  get(id: Id): Promise<{ doc: BoardDoc; etag: string } | null>;

  /**
   * Full replace. `ifMatch` guards an update; `null` means "create", which
   * fails with {@link PreconditionFailedError} if the board already exists.
   * The document is persisted verbatim — the caller stamps `updatedAt`.
   */
  put(id: Id, doc: BoardDoc, ifMatch: string | null): Promise<{ etag: string }>;

  /** Hard delete of the board blob and its index entry. Soft delete is a `put`. */
  delete(id: Id): Promise<void>;

  /** Copy the current document into `snapshots/`; returns the snapshot name. */
  snapshot(id: Id): Promise<string>;

  /** Newest first. */
  listSnapshots(id: Id): Promise<SnapshotRef[]>;

  /**
   * Read one restore point back. Beyond the sketch in spec 6.5, because
   * `POST /api/boards/{id}/restore` cannot be implemented without it.
   * `null` when that snapshot does not exist.
   */
  readSnapshot(id: Id, snapshotName: string): Promise<BoardDoc | null>;
}

export interface MediaStore {
  mintUploadSas(boardId: Id, mediaId: Id, contentType: string): Promise<UploadTarget>;

  /**
   * Where a given media id lives, without minting anything. Beyond the sketch
   * in spec 6.5, so `POST /api/media/commit` can HEAD the blob and build the
   * `MediaRef` without knowing how paths are laid out.
   */
  mediaPaths(
    boardId: Id,
    mediaId: Id,
    contentType: MediaContentType,
  ): { blobPath: string; thumbPath: string };

  /**
   * Container-scoped read SAS. Returns the account origin with the SAS query
   * appended, e.g. `https://stkarta.blob.core.windows.net?sv=…&sig=…`, so the
   * client can build `${origin}/${blobPath}?${query}` from a `MediaRef`.
   * Valid for {@link READ_SAS_TTL_MINUTES} minutes.
   */
  mintReadSas(): Promise<string>;

  /** `null` when the blob is not there. `path` may be container-inclusive. */
  head(path: string): Promise<{ bytes: number } | null>;

  /** Best effort; missing blobs are not an error. */
  delete(paths: string[]): Promise<void>;
}

/** Long enough to browse a board, short enough that a leaked URL dies fast. */
export const READ_SAS_TTL_MINUTES = 60;

/** One upload, one chance. */
export const UPLOAD_SAS_TTL_MINUTES = 5;

/** Backdate every SAS so a client clock a minute fast still works. */
export const SAS_CLOCK_SKEW_MINUTES = 2;
