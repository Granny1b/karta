/**
 * `MediaStore` over Azure Blob Storage.
 *
 * The browser uploads straight to blob storage with a short-lived, blob-scoped
 * SAS: the Function never touches the bytes, so the 30 MB Static Web Apps
 * request limit never applies and there is no server-side image library to
 * maintain (spec 6.2).
 *
 * Paths are container-inclusive everywhere they cross the wire —
 * `media/{boardId}/{mediaId}.webp` — matching `MediaRef.blobPath` in the shared
 * contract. Inside this class they are container-relative.
 */

import {
  BlobSASPermissions,
  type BlobServiceClient,
  ContainerSASPermissions,
  type ContainerClient,
  RestError,
  SASProtocol,
  type StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import type { Id, MediaContentType, UploadTarget } from '@domain/board';
import { BadRequestError } from '../domain/errors';
import { isUlid } from '../domain/validate';
import {
  type MediaStore,
  READ_SAS_TTL_MINUTES,
  SAS_CLOCK_SKEW_MINUTES,
  UPLOAD_SAS_TTL_MINUTES,
} from './types';

/** Thumbnails are always webp — the client encodes them (spec 4.1). */
export const THUMB_SUFFIX = '.thumb.webp';

const EXTENSIONS: Record<MediaContentType, string> = {
  'image/webp': '.webp',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export interface BlobMediaStoreOptions {
  service: BlobServiceClient;
  credential: StorageSharedKeyCredential;
  mediaContainer: string;
  /** Account origin without a trailing slash, e.g. `https://st….blob.core.windows.net`. */
  accountUrl: string;
}

export class BlobMediaStore implements MediaStore {
  private readonly container: ContainerClient;
  private readonly containerName: string;
  private readonly credential: StorageSharedKeyCredential;
  private readonly accountUrl: string;
  private containerReady: Promise<void> | null = null;

  constructor(options: BlobMediaStoreOptions) {
    this.containerName = options.mediaContainer;
    this.container = options.service.getContainerClient(options.mediaContainer);
    this.credential = options.credential;
    this.accountUrl = options.accountUrl.replace(/\/+$/, '');
  }

  async mintUploadSas(boardId: Id, mediaId: Id, contentType: string): Promise<UploadTarget> {
    if (!isUlid(boardId)) throw new BadRequestError('That is not a valid board id.');
    if (!isUlid(mediaId)) throw new BadRequestError('That is not a valid media id.');

    const extension = EXTENSIONS[contentType as MediaContentType];
    if (!extension) {
      throw new BadRequestError(`Unsupported media type "${contentType}".`);
    }

    await this.ready();

    const relative = `${boardId}/${mediaId}${extension}`;
    const thumbRelative = `${boardId}/${mediaId}${THUMB_SUFFIX}`;
    const { startsOn, expiresOn } = sasWindow(UPLOAD_SAS_TTL_MINUTES);
    const paths = this.mediaPaths(boardId, mediaId, contentType as MediaContentType);

    // 'cw' — create and write. No read, no delete: a leaked upload URL can add
    // one blob at one path and nothing else.
    const permissions = BlobSASPermissions.parse('cw');

    return {
      mediaId,
      blobPath: paths.blobPath,
      thumbPath: paths.thumbPath,
      uploadUrl: this.signedBlobUrl(relative, permissions, startsOn, expiresOn),
      thumbUploadUrl: this.signedBlobUrl(thumbRelative, permissions, startsOn, expiresOn),
    };
  }

  mediaPaths(
    boardId: Id,
    mediaId: Id,
    contentType: MediaContentType,
  ): { blobPath: string; thumbPath: string } {
    const extension = EXTENSIONS[contentType];
    if (!extension) throw new BadRequestError(`Unsupported media type "${contentType}".`);
    return {
      blobPath: `${this.containerName}/${boardId}/${mediaId}${extension}`,
      thumbPath: `${this.containerName}/${boardId}/${mediaId}${THUMB_SUFFIX}`,
    };
  }

  async mintReadSas(): Promise<string> {
    await this.ready();

    const { startsOn, expiresOn } = sasWindow(READ_SAS_TTL_MINUTES);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        permissions: ContainerSASPermissions.parse('rl'),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn,
      },
      this.credential,
    ).toString();

    return `${this.accountUrl}?${sas}`;
  }

  async head(path: string): Promise<{ bytes: number } | null> {
    await this.ready();
    try {
      const props = await this.container.getBlobClient(this.relative(path)).getProperties();
      return { bytes: props.contentLength ?? 0 };
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async delete(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.ready();

    const results = await Promise.allSettled(
      paths.map((path) => this.container.getBlobClient(this.relative(path)).deleteIfExists()),
    );

    results.forEach((result, i) => {
      if (result.status !== 'rejected') return;
      // An orphan that survives costs a fraction of a cent; failing the board
      // save that triggered the cleanup would cost the user their work.
      console.warn(`Could not delete orphaned blob ${paths[i]}:`, result.reason);
    });
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private signedBlobUrl(
    relative: string,
    permissions: BlobSASPermissions,
    startsOn: Date,
    expiresOn: Date,
  ): string {
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: relative,
        permissions,
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn,
      },
      this.credential,
    ).toString();

    const encoded = relative.split('/').map(encodeURIComponent).join('/');
    return `${this.accountUrl}/${this.containerName}/${encoded}?${sas}`;
  }

  /** Accepts both `media/{boardId}/…` and `{boardId}/…`. */
  private relative(path: string): string {
    const trimmed = path.trim();
    if (trimmed.length === 0 || trimmed.startsWith('/') || trimmed.includes('..')) {
      throw new BadRequestError('That is not a valid media path.');
    }
    const prefix = `${this.containerName}/`;
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  }

  private ready(): Promise<void> {
    if (!this.containerReady) {
      this.containerReady = this.container
        .createIfNotExists()
        .then(() => undefined)
        .catch((err: unknown) => {
          this.containerReady = null;
          throw err;
        });
    }
    return this.containerReady;
  }
}

/** Backdated start so a client clock running fast does not reject the SAS. */
function sasWindow(ttlMinutes: number): { startsOn: Date; expiresOn: Date } {
  const now = Date.now();
  return {
    startsOn: new Date(now - SAS_CLOCK_SKEW_MINUTES * 60_000),
    expiresOn: new Date(now + ttlMinutes * 60_000),
  };
}
