import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTER, useUiStore } from '@/state/uiStore';

/*
 * The filter is one for the whole app, but the label and status ids in it name
 * things on one board. An id the open board does not have matches no card at
 * all, and it cannot be unticked from lists that do not show it.
 */
describe('retainFilterIds', () => {
  beforeEach(() => useUiStore.getState().clearFilter());

  it('drops ids the open board does not have and keeps the rest of the filter', () => {
    useUiStore.getState().setFilter({ text: 'boss', labelIds: ['L1', 'gone'], statusIds: ['S1', 'elsewhere'], hasDue: true });

    useUiStore.getState().retainFilterIds(new Set(['L1']), new Set(['S1']));

    expect(useUiStore.getState().filter).toEqual({
      ...EMPTY_FILTER,
      text: 'boss',
      labelIds: ['L1'],
      statusIds: ['S1'],
      hasDue: true,
    });
  });

  it('leaves the filter object alone when every id is still there', () => {
    useUiStore.getState().setFilter({ labelIds: ['L1'] });
    const before = useUiStore.getState().filter;

    useUiStore.getState().retainFilterIds(new Set(['L1', 'L2']), new Set());

    expect(useUiStore.getState().filter).toBe(before);
  });
});
