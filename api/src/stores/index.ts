/**
 * Store singletons.
 *
 * Configuration is read on first use rather than at import time, so a missing
 * app setting fails one request with a message naming the setting instead of
 * killing the whole Function host at load with a stack trace.
 */

import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { BlobBoardStore } from './blobBoardStore.js';
import { BlobMediaStore } from './blobMediaStore.js';
import type { BoardStore, MediaStore } from './types.js';

interface StorageConfig {
  service: BlobServiceClient;
  credential: StorageSharedKeyCredential;
  accountUrl: string;
  boardsContainer: string;
  mediaContainer: string;
  snapshotsContainer: string;
}

let config: StorageConfig | null = null;
let boardStore: BoardStore | null = null;
let mediaStore: MediaStore | null = null;

export function getBoardStore(): BoardStore {
  if (!boardStore) {
    const c = getConfig();
    boardStore = new BlobBoardStore({
      service: c.service,
      boardsContainer: c.boardsContainer,
      snapshotsContainer: c.snapshotsContainer,
    });
  }
  return boardStore;
}

export function getMediaStore(): MediaStore {
  if (!mediaStore) {
    const c = getConfig();
    mediaStore = new BlobMediaStore({
      service: c.service,
      credential: c.credential,
      mediaContainer: c.mediaContainer,
      accountUrl: c.accountUrl,
    });
  }
  return mediaStore;
}

function getConfig(): StorageConfig {
  if (config) return config;

  const connectionString = requireSetting('STORAGE_CONNECTION_STRING');
  const { accountName, accountKey, accountUrl } = parseConnectionString(connectionString);
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  config = {
    service: new BlobServiceClient(accountUrl, credential),
    credential,
    accountUrl,
    boardsContainer: setting('BOARDS_CONTAINER', 'boards'),
    mediaContainer: setting('MEDIA_CONTAINER', 'media'),
    snapshotsContainer: setting('SNAPSHOTS_CONTAINER', 'snapshots'),
  };
  return config;
}

function setting(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function requireSetting(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`App setting ${name} is not configured on this deployment.`);
  }
  return value.trim();
}

/**
 * Azurite's well-known development account — what `UseDevelopmentStorage=true`
 * is shorthand for. The Azure SDKs and the Functions host both expand it, so
 * the shorthand is what a developer writes and what `local.settings.json`
 * ships with; expanding it here is what makes that true of this store too.
 */
const AZURITE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;' +
  'AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;';

const DEVELOPMENT_SHORTHAND_RE = /^usedevelopmentstorage\s*=\s*true;?$/i;

/**
 * The shared key is pulled out explicitly rather than using
 * `BlobServiceClient.fromConnectionString`, because SAS minting needs the same
 * `StorageSharedKeyCredential` instance and the client does not hand it back.
 */
export function parseConnectionString(cs: string): {
  accountName: string;
  accountKey: string;
  accountUrl: string;
} {
  const trimmed = cs.trim();
  const expanded = DEVELOPMENT_SHORTHAND_RE.test(trimmed) ? AZURITE_CONNECTION_STRING : trimmed;

  // Split on the first '=' only: an account key is base64 and ends in padding.
  const parts = new Map<string, string>();
  for (const segment of expanded.split(';')) {
    const at = segment.indexOf('=');
    if (at <= 0) continue;
    parts.set(segment.slice(0, at).trim().toLowerCase(), segment.slice(at + 1).trim());
  }

  const accountName = parts.get('accountname') ?? '';
  const accountKey = parts.get('accountkey') ?? '';
  if (!accountName || !accountKey) {
    throw new Error(
      'STORAGE_CONNECTION_STRING must contain AccountName and AccountKey (shared key auth).',
    );
  }

  const protocol = parts.get('defaultendpointsprotocol') ?? 'https';
  const suffix = parts.get('endpointsuffix') ?? 'core.windows.net';
  const accountUrl = (
    parts.get('blobendpoint') ?? `${protocol}://${accountName}.blob.${suffix}`
  ).replace(/\/+$/, '');

  return { accountName, accountKey, accountUrl };
}
