import { describe, expect, it } from 'vitest';
import { parseConnectionString } from './index.js';

describe('parseConnectionString', () => {
  it('expands the UseDevelopmentStorage shorthand that local.settings.json ships', () => {
    const parsed = parseConnectionString('UseDevelopmentStorage=true');

    expect(parsed.accountName).toBe('devstoreaccount1');
    expect(parsed.accountKey.length).toBeGreaterThan(0);
    expect(parsed.accountUrl).toBe('http://127.0.0.1:10000/devstoreaccount1');
  });

  it('accepts the shorthand however it was typed', () => {
    for (const value of ['usedevelopmentstorage=true', ' UseDevelopmentStorage = true; ']) {
      expect(parseConnectionString(value).accountName).toBe('devstoreaccount1');
    }
  });

  it('parses a deployed shared-key string', () => {
    const parsed = parseConnectionString(
      'DefaultEndpointsProtocol=https;AccountName=stkarta;AccountKey=a2V5==;EndpointSuffix=core.windows.net',
    );

    expect(parsed.accountName).toBe('stkarta');
    // Split on the first '=' only, or base64 padding truncates the key.
    expect(parsed.accountKey).toBe('a2V5==');
    expect(parsed.accountUrl).toBe('https://stkarta.blob.core.windows.net');
  });

  it('prefers an explicit BlobEndpoint and drops its trailing slash', () => {
    const parsed = parseConnectionString(
      'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=a2V5==;' +
        'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1/;',
    );

    expect(parsed.accountUrl).toBe('http://127.0.0.1:10000/devstoreaccount1');
  });

  it('rejects a string with no shared key', () => {
    expect(() => parseConnectionString('DefaultEndpointsProtocol=https;AccountName=stkarta')).toThrow(
      /AccountName and AccountKey/,
    );
  });
});
