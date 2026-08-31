import { describe, expect, it } from 'vitest';
import { colorValue, edgeColor } from '@/lib/colors';
import { formatBytes, formatDue, formatRelative } from '@/lib/format';
import { lodForZoom } from '@/lib/lod';

const now = new Date('2026-03-12T12:00:00.000Z');

describe('format', () => {
  it('reads dates the way a person would say them', () => {
    expect(formatRelative('2026-03-12T11:59:30.000Z', now)).toBe('just now');
    expect(formatRelative('2026-03-12T11:00:00.000Z', now)).toBe('1 h ago');
    expect(formatRelative('2026-03-11T12:00:00.000Z', now)).toBe('yesterday');
    expect(formatRelative('2026-03-09T12:00:00.000Z', now)).toBe('3 days ago');
    expect(formatRelative(null, now)).toBe('');
  });

  it('sizes blobs', () => {
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(231_400)).toBe('231 KB');
    expect(formatBytes(1_430_000)).toBe('1.4 MB');
  });

  it('tones due dates by calendar day, not by hours', () => {
    expect(formatDue('2026-03-12T23:00:00.000Z', now)).toEqual({ text: 'Today', tone: 'today' });
    expect(formatDue('2026-03-13T01:00:00.000Z', now)).toEqual({ text: 'Tomorrow', tone: 'soon' });
    expect(formatDue('2026-03-11T23:00:00.000Z', now).tone).toBe('overdue');
    expect(formatDue(null, now)).toEqual({ text: '', tone: 'none' });
  });
});

describe('colors and level of detail', () => {
  it('resolves tokens, passes hex through and falls back to slate', () => {
    expect(colorValue('blue')).toBe('var(--temper-blue)');
    expect(colorValue('#AA00FF')).toBe('#AA00FF');
    expect(colorValue(null)).toBe('var(--temper-slate)');
    expect(colorValue('nonsense')).toBe('var(--temper-slate)');
    expect(edgeColor('blocks', null)).toBe('var(--edge-blocks)');
    expect(edgeColor('blocks', 'teal')).toBe('var(--temper-teal)');
  });

  it('switches level of detail at the spec boundaries', () => {
    expect(lodForZoom(1)).toBe('full');
    expect(lodForZoom(0.8)).toBe('full');
    expect(lodForZoom(0.79)).toBe('compact');
    expect(lodForZoom(0.4)).toBe('compact');
    expect(lodForZoom(0.39)).toBe('title');
    expect(lodForZoom(0.25)).toBe('title');
    expect(lodForZoom(0.24)).toBe('block');
  });
});
