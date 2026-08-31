import type {
  BoardDoc,
  BoardIndex,
  Id,
  Iso,
  Me,
  MediaContentType,
  MediaRef,
  SnapshotRef,
  UploadTarget,
} from '@/domain/board';

const BASE = '/api';

/**
 * Any non-2xx response, plus one synthetic case: `status === 0` means the
 * request never reached the server (offline, DNS, connection reset). The board
 * store keys its offline handling off that.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** The request never left the browser. */
  get offline(): boolean {
    return this.status === 0;
  }

  /** The ETag guard failed — someone else wrote the board first (spec 6.4). */
  get conflict(): boolean {
    return this.status === 412;
  }
}

interface Envelope<T> {
  data: T;
  etag: string | null;
}

function messageFrom(status: number, body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim().length > 0) return body.trim();
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
  }
  return `${fallback} (${status})`;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Envelope<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'No connection to the server');
  }

  const body = await readBody(res);
  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(res.status, body, res.statusText || 'Request failed'), body);
  }

  return { data: body as T, etag: res.headers.get('etag') };
}

function isBoardDoc(value: unknown): value is BoardDoc {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    'nodes' in value &&
    Array.isArray((value as { nodes: unknown }).nodes)
  );
}

/**
 * Board endpoints may answer with the bare document plus an `ETag` header, or
 * with `{ doc, etag }`. Both are accepted so neither side has to guess.
 */
function unwrapBoard(payload: unknown, headerEtag: string | null, context: string): { doc: BoardDoc; etag: string } {
  let doc: BoardDoc | null = null;
  let etag = headerEtag;

  if (isBoardDoc(payload)) {
    doc = payload;
  } else if (payload && typeof payload === 'object') {
    const record = payload as { doc?: unknown; etag?: unknown };
    if (isBoardDoc(record.doc)) doc = record.doc;
    if (typeof record.etag === 'string' && record.etag.length > 0) etag = record.etag;
  }

  if (!doc) throw new ApiError(500, `${context} returned no board document`, payload);
  if (!etag) throw new ApiError(500, `${context} returned no ETag`, payload);
  return { doc, etag };
}

export const api = {
  async me(): Promise<Me> {
    const { data } = await request<Me>('GET', '/me');
    return data;
  },

  async getIndex(): Promise<BoardIndex> {
    const { data } = await request<BoardIndex>('GET', '/boards');
    return data;
  },

  async createBoard(input: { title: string; parentBoardId?: Id | null }): Promise<{ doc: BoardDoc; etag: string }> {
    const { data, etag } = await request<unknown>('POST', '/boards', {
      body: { title: input.title, parentBoardId: input.parentBoardId ?? null },
    });
    return unwrapBoard(data, etag, 'Create board');
  },

  async getBoard(id: Id): Promise<{ doc: BoardDoc; etag: string }> {
    const { data, etag } = await request<unknown>('GET', `/boards/${encodeURIComponent(id)}`);
    return unwrapBoard(data, etag, 'Get board');
  },

  /**
   * Full replace. `ifMatch` is the ETag held since load — omitted only for a
   * first write. A `412` propagates untouched so the store can merge (spec 6.4).
   */
  async putBoard(
    id: Id,
    doc: BoardDoc,
    ifMatch: string | null,
    orphanBlobPaths: string[] = [],
  ): Promise<{ etag: string; doc: BoardDoc }> {
    const { data, etag } = await request<unknown>('PUT', `/boards/${encodeURIComponent(id)}`, {
      body: { doc, orphanBlobPaths },
      headers: ifMatch ? { 'If-Match': ifMatch } : undefined,
    });

    let nextEtag = etag;
    let nextDoc = doc;
    if (data && typeof data === 'object') {
      const record = data as { doc?: unknown; etag?: unknown };
      if (typeof record.etag === 'string' && record.etag.length > 0) nextEtag = record.etag;
      if (isBoardDoc(record.doc)) nextDoc = record.doc;
      else if (isBoardDoc(data)) nextDoc = data;
    }
    if (!nextEtag) throw new ApiError(500, 'Save returned no ETag', data);
    return { etag: nextEtag, doc: nextDoc };
  },

  async deleteBoard(id: Id): Promise<void> {
    await request<unknown>('DELETE', `/boards/${encodeURIComponent(id)}`);
  },

  async snapshot(id: Id): Promise<{ snapshotName: string }> {
    const { data } = await request<{ snapshotName?: string; name?: string }>(
      'POST',
      `/boards/${encodeURIComponent(id)}/snapshot`,
    );
    const name = data?.snapshotName ?? data?.name;
    if (!name) throw new ApiError(500, 'Snapshot returned no name', data);
    return { snapshotName: name };
  },

  async listSnapshots(id: Id): Promise<SnapshotRef[]> {
    const { data } = await request<SnapshotRef[] | { snapshots?: SnapshotRef[] }>(
      'GET',
      `/boards/${encodeURIComponent(id)}/snapshots`,
    );
    if (Array.isArray(data)) return data;
    return data?.snapshots ?? [];
  },

  async restore(id: Id, snapshotName: string): Promise<{ doc: BoardDoc; etag: string }> {
    const { data, etag } = await request<unknown>('POST', `/boards/${encodeURIComponent(id)}/restore`, {
      body: { snapshotName },
    });
    return unwrapBoard(data, etag, 'Restore');
  },

  async mediaUploadUrl(input: {
    boardId: Id;
    contentType: MediaContentType;
    bytes: number;
  }): Promise<UploadTarget> {
    const { data } = await request<UploadTarget>('POST', '/media/upload-url', { body: input });
    return data;
  },

  async mediaCommit(input: {
    boardId: Id;
    mediaId: Id;
    width: number;
    height: number;
    bytes: number;
    contentType: MediaContentType;
  }): Promise<{ mediaRef: MediaRef }> {
    const { data } = await request<{ mediaRef?: MediaRef } & Partial<MediaRef>>('POST', '/media/commit', {
      body: input,
    });
    const ref = data?.mediaRef ?? (data && 'blobPath' in data ? (data as MediaRef) : undefined);
    if (!ref) throw new ApiError(500, 'Media commit returned no media reference', data);
    return { mediaRef: ref };
  },

  async mediaReadToken(): Promise<{ sas: string; expiresAt: Iso }> {
    const { data } = await request<{ sas: string; expiresAt: Iso }>('GET', '/media/read-token');
    return data;
  },
};
