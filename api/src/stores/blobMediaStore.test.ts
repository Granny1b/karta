import {
  StorageSharedKeyCredential,
  type BlobServiceClient,
  type ContainerClient,
} from '@azure/storage-blob';
import { describe, expect, it } from 'vitest';
import { BlobMediaStore } from './blobMediaStore.js';

/** Azurite's well-known development key — valid base64, signs nothing real. */
const DEV_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

function store(accountUrl: string): BlobMediaStore {
  const container = { createIfNotExists: () => Promise.resolve({}) } as unknown as ContainerClient;
  const service = { getContainerClient: () => container } as unknown as BlobServiceClient;

  return new BlobMediaStore({
    service,
    credential: new StorageSharedKeyCredential('devstoreaccount1', DEV_KEY),
    mediaContainer: 'media',
    accountUrl,
  });
}

async function readSasParams(accountUrl: string): Promise<URLSearchParams> {
  const url = await store(accountUrl).mintReadSas();
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

describe('BlobMediaStore.mintReadSas', () => {
  it('grants read only — never container list', async () => {
    const params = await readSasParams('https://stkarta.blob.core.windows.net');

    // 'l' would turn a per-user read token into an index of every board's
    // blobs, across every ACL, for the lifetime of the SAS.
    expect(params.get('sp')).toBe('r');
    expect(params.get('sr')).toBe('c');
  });

  it('pins https against a deployed account', async () => {
    const params = await readSasParams('https://stkarta.blob.core.windows.net');
    expect(params.get('spr')).toBe('https');
  });

  it('allows http against an Azurite endpoint, which is not https', async () => {
    const params = await readSasParams('http://127.0.0.1:10000/devstoreaccount1');
    expect(params.get('spr')).toBe('https,http');
  });
});
