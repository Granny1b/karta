import { describe, expect, it } from 'vitest';
import { byRank, rankAfterAll, rankBeforeAll, rankBetween } from '@/lib/ranks';

describe('ranks', () => {
  it('produces keys that sort where they were asked to sort', () => {
    const first = rankBetween(null, null);
    const last = rankAfterAll([first]);
    const middle = rankBetween(first, last);

    expect([first, middle, last].slice().sort()).toEqual([first, middle, last]);
    expect(rankBeforeAll([first]) < first).toBe(true);
    expect(rankAfterAll([])).toBe(first);
  });

  it('survives bounds that arrive equal, reversed or malformed', () => {
    const a = rankBetween(null, null);
    const b = rankAfterAll([a]);

    expect(rankBetween(b, a) > a).toBe(true);
    expect(rankBetween(b, a) < b).toBe(true);
    expect(rankBetween(a, a)).not.toEqual(a);
    expect(rankBetween('!!! not a key', null)).toBeTruthy();
    expect(rankBeforeAll(['', 'zzz-nonsense'])).toBeTruthy();
  });

  it('sorts by rank', () => {
    const a = rankBetween(null, null);
    const b = rankAfterAll([a]);
    expect([{ rank: b }, { rank: a }].sort(byRank).map((x) => x.rank)).toEqual([a, b]);
  });
});
