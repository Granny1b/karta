import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';

/**
 * `messageFrom` is not exported, so these drive it through the same paths the
 * request helper does. The regression they guard: Static Web Apps rewrites a
 * 403 to the whole `no-access.html` document, which used to be rendered
 * verbatim as the error message.
 */
const NO_ACCESS_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>No access — Karta</title>
<style>:root { --surface-canvas: #edf0f3; }</style></head>
<body><main class="card"><h1>No access</h1><p>This board is invitation-only.</p></main></body></html>`;

describe('ApiError', () => {
  it('classifies the statuses the store branches on', () => {
    expect(new ApiError(0, 'x').offline).toBe(true);
    expect(new ApiError(412, 'x').conflict).toBe(true);
    expect(new ApiError(403, 'x').forbidden).toBe(true);
    expect(new ApiError(403, 'x').offline).toBe(false);
    expect(new ApiError(200, 'x').conflict).toBe(false);
  });

  it('keeps the body available for callers that want it', () => {
    const err = new ApiError(403, 'Denied', NO_ACCESS_PAGE);
    expect(err.body).toBe(NO_ACCESS_PAGE);
    expect(err.status).toBe(403);
  });
});

describe('error messages', () => {
  it('never renders an HTML rewrite as the message', async () => {
    const { messageForTest } = await import('@/lib/api');
    const msg = messageForTest(403, NO_ACCESS_PAGE, 'Forbidden');
    expect(msg).not.toContain('<!doctype');
    expect(msg).not.toContain('--surface-canvas');
    expect(msg).toMatch(/member role/i);
  });

  it('explains each status the app actually produces', async () => {
    const { messageForTest } = await import('@/lib/api');
    expect(messageForTest(401, null, 'x')).toMatch(/sign in/i);
    expect(messageForTest(412, null, 'x')).toMatch(/changed somewhere else/i);
    expect(messageForTest(413, null, 'x')).toMatch(/nested board/i);
    expect(messageForTest(500, null, 'x')).toMatch(/server failed/i);
  });

  it('still prefers a real message from the API', async () => {
    const { messageForTest } = await import('@/lib/api');
    expect(messageForTest(400, { error: 'boardId is not a ULID' }, 'x')).toBe('boardId is not a ULID');
    expect(messageForTest(400, 'Short and useful', 'x')).toBe('Short and useful');
  });

  it('drops a body too long to be a message', async () => {
    const { messageForTest } = await import('@/lib/api');
    const wall = 'x'.repeat(5000);
    expect(messageForTest(500, wall, 'x')).not.toContain(wall);
  });
});

describe('a lapsed sign-in', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /*
   * Static Web Apps answers an expired session on /api with a redirect to the
   * sign-in page. Followed, it crossed to the identity provider and failed
   * CORS, which `fetch` reports exactly like a dropped connection — so the app
   * said "Offline" for ever instead of asking anyone to sign in.
   */
  it('is told apart from a dropped connection', async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ type: 'opaqueredirect', status: 0, ok: false }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetch);

    const err = await api.getIndex().catch((e: unknown) => e);

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).signedOut).toBe(true);
    expect((err as ApiError).offline).toBe(false);
    expect((err as ApiError).message).toMatch(/sign in/i);
  });

  it('reads a bare redirect the same way, where a runtime hands one back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ type: 'basic', status: 302, ok: false }) as unknown as Response),
    );
    const err = await api.getIndex().catch((e: unknown) => e);
    expect((err as ApiError).signedOut).toBe(true);
  });

  it('still reports a network failure as offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = await api.getIndex().catch((e: unknown) => e);
    expect((err as ApiError).offline).toBe(true);
  });
});
