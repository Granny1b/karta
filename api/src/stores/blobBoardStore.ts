/**
 * `BoardStore` over Azure Blob Storage.
 *
 * Layout:
 *   boards/{boardId}.json          the document, ETag-guarded
 *   boards/_index.json             the summary index (spec 5.4)
 *   snapshots/{boardId}/{iso}.json restore points
 *
 * Two concurrency rules matter here. A board write carries the client's ETag
 * straight through to the blob condition, so a lost update surfaces as a 412
 * rather than silently overwriting. The index is a *shared* blob, so it is
 * read-modify-written under its own ETag with a short retry loop: two boards
 * saved in the same second must not drop each other's entry.
 */

import { RestError, type BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import type { BoardDoc, BoardIndex, Id, SnapshotRef } from '@domain/board';
import { buildSummary, emptyIndex, removeSummary, upsertSummary } from '../domain/index-doc';
import { BadRequestError, NotFoundError, PreconditionFailedError } from '../domain/errors';
import { migrate } from '../domain/migrate';
import { isSnapshotName, isUlid } from '../domain/validate';
import type { BoardStore } from './types';

const INDEX_BLOB = '_index.json';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const INDEX_MAX_ATTEMPTS = 6;

export interface BlobBoardStoreOptions {
  service: BlobServiceClient;
  boardsContainer: string;
  snapshotsContainer: string;
}

export class BlobBoardStore implements BoardStore {
  private readonly boards: ContainerClient;
  private readonly snapshots: ContainerClient;
  private containersReady: Promise<void> | null = null;

  constructor(options: BlobBoardStoreOptions) {
    this.boards = options.service.getContainerClient(options.boardsContainer);
    this.snapshots = options.service.getContainerClient(options.snapshotsContainer);
  }

  /* ---------------------------------------------------------------- *
   * Boards
   * ---------------------------------------------------------------- */

  async getIndex(): Promise<BoardIndex> {
    await this.ready();
    const found = await this.readIndex();
    return found ? found.index : emptyIndex();
  }

  async get(id: Id): Promise<{ doc: BoardDoc; etag: string } | null> {
    assertBoardId(id);
    await this.ready();

    const blob = this.boards.getBlockBlobClient(`${id}.json`);
    let text: string;
    let etag: string;
    try {
      const res = await blob.download();
      text = await streamToString(res.readableStreamBody);
      if (!res.etag) throw new Error(`Blob ${id}.json came back without an ETag.`);
      etag = res.etag;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }

    return { doc: migrate(JSON.parse(text)), etag };
  }

  async put(id: Id, doc: BoardDoc, ifMatch: string | null): Promise<{ etag: string }> {
    assertBoardId(id);
    await this.ready();

    const body = JSON.stringify(doc);
    const blob = this.boards.getBlockBlobClient(`${id}.json`);

    let etag: string;
    try {
      const res = await blob.upload(body, Buffer.byteLength(body, 'utf8'), {
        blobHTTPHeaders: { blobContentType: JSON_CONTENT_TYPE, blobCacheControl: 'no-store' },
        conditions: ifMatch ? { ifMatch } : { ifNoneMatch: '*' },
      });
      if (!res.etag) throw new Error(`Blob ${id}.json was written without returning an ETag.`);
      etag = res.etag;
    } catch (err) {
      if (isPreconditionFailure(err)) {
        throw new PreconditionFailedError(
          ifMatch
            ? 'This board changed somewhere else since you loaded it.'
            : 'A board with that id already exists.',
        );
      }
      throw err;
    }

    // The document is durable at this point. A failure to refresh the index
    // leaves the sidebar stale until the next save, which is a far smaller
    // problem than telling the client its save failed when it did not.
    await this.refreshIndex(id, (index) => upsertSummary(index, buildSummary(doc)));

    return { etag };
  }

  async delete(id: Id): Promise<void> {
    assertBoardId(id);
    await this.ready();

    await this.boards.getBlockBlobClient(`${id}.json`).deleteIfExists();
    await this.refreshIndex(id, (index) => removeSummary(index, id));
  }

  /* ---------------------------------------------------------------- *
   * Snapshots
   * ---------------------------------------------------------------- */

  async snapshot(id: Id): Promise<string> {
    assertBoardId(id);
    await this.ready();

    let text: string;
    try {
      const res = await this.boards.getBlockBlobClient(`${id}.json`).download();
      text = await streamToString(res.readableStreamBody);
    } catch (err) {
      if (isNotFound(err)) throw new NotFoundError('That board does not exist.');
      throw err;
    }

    const name = snapshotName(new Date());
    await this.snapshots
      .getBlockBlobClient(`${id}/${name}`)
      .upload(text, Buffer.byteLength(text, 'utf8'), {
        blobHTTPHeaders: { blobContentType: JSON_CONTENT_TYPE },
      });

    return name;
  }

  async listSnapshots(id: Id): Promise<SnapshotRef[]> {
    assertBoardId(id);
    await this.ready();

    const prefix = `${id}/`;
    const refs: SnapshotRef[] = [];
    for await (const blob of this.snapshots.listBlobsFlat({ prefix })) {
      const name = blob.name.slice(prefix.length);
      if (!isSnapshotName(name)) continue;
      const created = blob.properties.createdOn ?? blob.properties.lastModified;
      refs.push({
        name,
        createdAt: created.toISOString(),
        bytes: blob.properties.contentLength ?? 0,
      });
    }

    // Names are lexicographically ordered by time, so this is newest first.
    refs.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    return refs;
  }

  async readSnapshot(id: Id, name: string): Promise<BoardDoc | null> {
    assertBoardId(id);
    if (!isSnapshotName(name)) {
      throw new BadRequestError('That is not a valid restore point name.');
    }
    await this.ready();

    try {
      const res = await this.snapshots.getBlockBlobClient(`${id}/${name}`).download();
      const text = await streamToString(res.readableStreamBody);
      return migrate(JSON.parse(text));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /** Create both containers once per process. Idempotent and cached. */
  private ready(): Promise<void> {
    if (!this.containersReady) {
      this.containersReady = Promise.all([
        this.boards.createIfNotExists(),
        this.snapshots.createIfNotExists(),
      ])
        .then(() => undefined)
        .catch((err: unknown) => {
          this.containersReady = null; // let the next request try again
          throw err;
        });
    }
    return this.containersReady;
  }

  private async readIndex(): Promise<{ index: BoardIndex; etag: string } | null> {
    try {
      const res = await this.boards.getBlockBlobClient(INDEX_BLOB).download();
      const text = await streamToString(res.readableStreamBody);
      if (!res.etag) throw new Error('Board index came back without an ETag.');
      return { index: parseIndex(text), etag: res.etag };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Read-modify-write the shared index under its own ETag. On contention the
   * whole cycle is retried, so the losing writer re-reads the winner's version
   * and re-applies its own change instead of clobbering it.
   */
  private async writeIndex(mutate: (index: BoardIndex) => BoardIndex): Promise<void> {
    for (let attempt = 0; attempt < INDEX_MAX_ATTEMPTS; attempt++) {
      const current = await this.readIndex();
      const next = mutate(current ? current.index : emptyIndex());
      const body = JSON.stringify(next);

      try {
        await this.boards
          .getBlockBlobClient(INDEX_BLOB)
          .upload(body, Buffer.byteLength(body, 'utf8'), {
            blobHTTPHeaders: { blobContentType: JSON_CONTENT_TYPE, blobCacheControl: 'no-store' },
            conditions: current ? { ifMatch: current.etag } : { ifNoneMatch: '*' },
          });
        return;
      } catch (err) {
        if (!isPreconditionFailure(err)) throw err;
        await sleep(25 * (attempt + 1) + Math.floor(Math.random() * 40));
      }
    }

    throw new Error(`Board index stayed contended after ${INDEX_MAX_ATTEMPTS} attempts.`);
  }

  private async refreshIndex(
    boardId: Id,
    mutate: (index: BoardIndex) => BoardIndex,
  ): Promise<void> {
    try {
      await this.writeIndex(mutate);
    } catch (err) {
      console.error(
        `Board ${boardId} was written but the index update failed; it will self-heal on the next save.`,
        err,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function assertBoardId(id: Id): void {
  // Board ids reach blob names directly, so this is a path-traversal guard as
  // much as a validation.
  if (!isUlid(id)) throw new BadRequestError('That is not a valid board id.');
}

/** `2026-08-31T09-12-44-071Z.json` — sortable, and legal in a blob name. */
function snapshotName(at: Date): string {
  return `${at.toISOString().replace(/[:.]/g, '-')}.json`;
}

function parseIndex(text: string): BoardIndex {
  const raw: unknown = JSON.parse(text);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { boards?: unknown }).boards)
  ) {
    // Refuse to overwrite something unrecognisable — a bad index is worth
    // inspecting, and blob soft delete keeps 14 days of history either way.
    throw new Error('Board index is not a valid index document.');
  }
  return raw as BoardIndex;
}

function streamToString(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) return Promise.resolve('');
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function statusOf(err: unknown): number | undefined {
  return err instanceof RestError ? err.statusCode : undefined;
}

function isNotFound(err: unknown): boolean {
  return statusOf(err) === 404;
}

/** Azure answers a failed `ifMatch` with 412 and a failed `ifNoneMatch: '*'` with 409. */
function isPreconditionFailure(err: unknown): boolean {
  const status = statusOf(err);
  return status === 412 || status === 409;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
