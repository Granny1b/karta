import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { BoardDoc, Id } from '@/domain/board';
import type { BoardState } from '@/state/boardStore';
import { extractToBoard, type ExtractApi } from '@/canvas/extract';
import { makeBoard, makeBoardLink, makeCard } from '@/state/factories';

/*
 * Extract moves board tiles like any other node. The boards behind them are
 * separate documents whose nesting is read from `parentBoardId` — by the tree,
 * the breadcrumb and a delete's subtree — so a moved tile has to take its board
 * with it, or the tree and the canvas describe two different hierarchies.
 */

interface Stored {
  doc: BoardDoc;
  etag: string;
}

function world(parent: BoardDoc, others: BoardDoc[]) {
  const server = new Map<Id, Stored>();
  let version = 0;
  const store = (doc: BoardDoc): Stored => {
    version += 1;
    const stored = { doc, etag: `"v${version}"` };
    server.set(doc.id, stored);
    return stored;
  };
  for (const doc of [parent, ...others]) store(doc);

  const refused = new Set<Id>();
  const api: ExtractApi = {
    async createBoard({ title, parentBoardId }) {
      return store(makeBoard({ title, ownerId: 'u1', parentBoardId: parentBoardId ?? null }));
    },
    async getBoard(id) {
      const found = server.get(id);
      if (!found) throw new Error('404');
      return found;
    },
    async putBoard(id, doc, ifMatch) {
      if (refused.has(id) || server.get(id)?.etag !== ifMatch) throw new Error('412');
      return store(doc);
    },
    async snapshot() {
      return { snapshotName: 'snap' };
    },
  };

  let doc = parent;
  let indexLoads = 0;
  const state = (): BoardState =>
    ({
      doc,
      boardId: doc.id,
      dirty: false,
      me: { userId: 'u1' },
      save: async () => {},
      loadIndex: async () => {
        indexLoads += 1;
      },
      mutate: (_label: string, recipe: (d: BoardDoc) => void) => {
        doc = produce(doc, recipe);
      },
    }) as unknown as BoardState;

  const warnings: string[] = [];
  return {
    server,
    refused,
    warnings,
    indexLoads: () => indexLoads,
    deps: { getState: state, api, onWarning: (message: string) => warnings.push(message) },
  };
}

const PARENT = '01PARENT';

function setup() {
  const nested = makeBoard({ title: 'Netcode', ownerId: 'u1', id: '01NESTED', parentBoardId: PARENT });
  const elsewhere = makeBoard({ title: 'Lore', ownerId: 'u1', id: '01ELSEWHERE', parentBoardId: '01OTHERPARENT' });
  const toNested = makeBoardLink({ targetBoardId: nested.id, cachedTitle: 'Netcode' });
  const shortcut = makeBoardLink({ targetBoardId: elsewhere.id, cachedTitle: 'Lore' });
  const card = makeCard({ title: 'Card' });
  const parent: BoardDoc = {
    ...makeBoard({ title: 'Root', ownerId: 'u1', id: PARENT }),
    nodes: [toNested, shortcut, card],
  };
  return { ...world(parent, [nested, elsewhere]), nested, elsewhere, ids: [toNested.id, shortcut.id, card.id] };
}

describe('extractToBoard', () => {
  it('nests the boards behind moved tiles under the new board', async () => {
    const t = setup();

    const result = await extractToBoard(t.deps, t.ids, 'Gameplay');

    expect(t.server.get(t.nested.id)?.doc.parentBoardId).toBe(result.boardId);
    expect(t.warnings).toEqual([]);
    // The tree is refreshed at once, not on the next poll.
    expect(t.indexLoads()).toBe(1);
  });

  it('leaves a board nested elsewhere where it is: that tile was a shortcut', async () => {
    const t = setup();

    await extractToBoard(t.deps, t.ids, 'Gameplay');

    expect(t.server.get(t.elsewhere.id)?.doc.parentBoardId).toBe('01OTHERPARENT');
  });

  it('finishes the extract and says so when a board could not be moved', async () => {
    const t = setup();
    t.refused.add(t.nested.id);

    const result = await extractToBoard(t.deps, t.ids, 'Gameplay');

    expect(result.nodeCount).toBe(3);
    expect(t.server.get(t.nested.id)?.doc.parentBoardId).toBe(PARENT);
    expect(t.warnings).toHaveLength(1);
    expect(t.warnings[0]).toContain('Root');
  });
});
