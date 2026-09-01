import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_SIZE,
  isCardNode,
  isNoteNode,
  isShapeNode,
  isTextNode,
  type BoardDoc,
} from '@/domain/board';
import {
  makeBoard,
  makeBoardLink,
  makeCard,
  makeChecklistItem,
  makeEdge,
  makeGroup,
  makeImageNode,
  makeNote,
} from '@/state/factories';
import { applyImport } from '@/io/importer';
import { exportFull, exportPortable, toPortable } from '@/io/exporter';
import { IMPORT_LIMITS, validateImport } from '@/io/schema';

const board = (): BoardDoc => makeBoard({ title: 'Test', ownerId: 'u1' });

const validated = (raw: unknown) => {
  const result = validateImport(raw);
  if (!result.ok) throw new Error(`expected valid input, got: ${result.errors.join(' / ')}`);
  return result;
};

describe('validateImport', () => {
  it('accepts a bare array of cards', () => {
    const result = validated([{ title: 'One' }, { title: 'Two' }]);
    expect(result.value.cards?.map((c) => c.title)).toEqual(['One', 'Two']);
  });

  it('names the exact path of every problem', () => {
    const result = validateImport({ cards: [{ title: 'ok' }, { body: 'no title' }, { title: 42 }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('cards[1].title is required.');
    expect(result.errors).toContain('cards[2].title must be text.');
  });

  it('warns about unknown fields instead of failing', () => {
    const result = validated({ cards: [{ title: 'One', priority: 'high' }] });
    expect(result.warnings.some((w) => w.includes('cards[0].priority'))).toBe(true);
  });

  it('normalises dates and drops colours it does not know', () => {
    const result = validated({ cards: [{ title: 'One', due: '2026-04-30', color: 'neon' }] });
    expect(result.value.cards?.[0].due).toBe('2026-04-30T00:00:00.000Z');
    expect(result.value.cards?.[0].color).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('neon'))).toBe(true);
  });

  it('refuses input with nothing in it', () => {
    expect(validateImport({ kartaVersion: 1 }).ok).toBe(false);
    expect(validateImport('nope').ok).toBe(false);
  });
});

describe('applyImport', () => {
  const input = validated({
    statuses: [{ name: 'Blocked', color: 'copper' }],
    cards: [
      { key: 'a', title: 'Sign-in', status: 'Idé', labels: ['infra'], checklist: ['Register app'] },
      { key: 'b', title: 'Role check', status: 'Blocked' },
    ],
    notes: [{ text: 'Remember the redirect URI' }],
    edges: [
      { from: 'b', to: 'a', semantic: 'depends' },
      { from: 'b', to: 'Sign-in', semantic: 'relates' },
      { from: 'b', to: 'Nothing here' },
    ],
  }).value;

  it('creates nodes, labels and statuses, and resolves edges by key and by title', () => {
    const { doc, summary } = applyImport(board(), input, 'u1', 'merge');

    expect(summary.cards).toBe(2);
    expect(summary.notes).toBe(1);
    expect(summary.edges).toBe(2);
    expect(summary.labelsCreated).toEqual(['infra']);
    expect(summary.statusesCreated).toEqual(['Blocked']);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain('Nothing here');

    const cards = doc.nodes.filter(isCardNode);
    const signIn = cards.find((c) => c.title === 'Sign-in');
    const roleCheck = cards.find((c) => c.title === 'Role check');
    expect(signIn?.statusId).toBe(doc.statuses.find((s) => s.name === 'Idé')?.id);
    expect(signIn?.labelIds).toEqual([doc.labels[0].id]);
    expect(signIn?.checklist).toHaveLength(1);
    expect(doc.edges.every((e) => e.source === roleCheck?.id)).toBe(true);
    expect(doc.edges[0].target).toBe(signIn?.id);
  });

  it('lays out cards without positions in a grid, and leaves the input document alone', () => {
    const start = board();
    const { doc } = applyImport(start, input, 'u1', 'merge');
    expect(start.nodes).toHaveLength(0);
    const positions = doc.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('merges below what is already there, and replace clears first', () => {
    const first = applyImport(board(), input, 'u1', 'merge').doc;
    const merged = applyImport(first, input, 'u1', 'merge').doc;
    expect(merged.nodes).toHaveLength(6);
    expect(merged.labels).toHaveLength(1); // the label was reused, not duplicated
    const lowestFirst = Math.max(...first.nodes.map((n) => n.position.y + n.size.h));
    expect(Math.min(...merged.nodes.slice(3).map((n) => n.position.y))).toBeGreaterThan(lowestFirst);

    const replaced = applyImport(merged, input, 'u1', 'replace').doc;
    expect(replaced.nodes).toHaveLength(3);
    expect(replaced.statuses).toEqual(merged.statuses); // columns survive a replace
  });

  it('ranks cards within their own column, appending on a second import', () => {
    const column = validated({
      cards: [
        { title: 'One', status: 'Idé' },
        { title: 'Two', status: 'Idé' },
      ],
    }).value;

    const first = applyImport(board(), column, 'u1', 'merge').doc;
    const ranks = first.nodes.filter(isCardNode).map((c) => c.rank);
    expect(new Set(ranks).size).toBe(2);
    expect(ranks[0] < ranks[1]).toBe(true);

    const second = applyImport(first, column, 'u1', 'merge').doc;
    const all = second.nodes.filter(isCardNode).map((c) => c.rank);
    expect(new Set(all).size).toBe(4);
    expect([...all].sort()).toEqual(all); // the new pair lands after the old
  });
});

describe('export', () => {
  it('round-trips through the portable format', () => {
    const source = applyImport(
      board(),
      validated({
        cards: [
          { key: 'a', title: 'Sign-in', body: '# why', labels: ['infra'], due: '2026-04-30' },
          { key: 'b', title: 'Role check', checklist: [{ text: 'Wire it', done: true }] },
        ],
        edges: [{ from: 'b', to: 'a', semantic: 'depends', label: 'needs' }],
      }).value,
      'u1',
      'merge',
    ).doc;

    const portable = toPortable(source);
    expect(portable.cards?.map((c) => c.title)).toEqual(['Sign-in', 'Role check']);
    expect(portable.cards?.[0].position).toBeUndefined(); // grid positions are implied
    expect(portable.cards?.[0].due).toBe('2026-04-30');
    expect(portable.cards?.[1].checklist).toEqual([{ text: 'Wire it', done: true }]);
    expect(portable.edges).toEqual([
      { from: 'Role check', to: 'Sign-in', semantic: 'depends', label: 'needs' },
    ]);

    const again = applyImport(board(), validated(portable).value, 'u1', 'merge');
    expect(again.summary.cards).toBe(2);
    expect(again.summary.edges).toBe(1);
    expect(again.summary.warnings).toHaveLength(0);
    expect(JSON.parse(exportPortable(again.doc))).toEqual(JSON.parse(exportPortable(source)));
  });

  it('reads a full board document back in', () => {
    const source = applyImport(
      board(),
      validated({ cards: [{ title: 'One', status: 'Klar' }] }).value,
      'u1',
      'merge',
    ).doc;

    const result = validated(JSON.parse(JSON.stringify(source)));
    expect(result.value.cards?.[0].status).toBe('Klar');
    const { doc, summary } = applyImport(board(), result.value, 'u1', 'replace');
    expect(summary.cards).toBe(1);
    expect(doc.nodes.filter(isCardNode)[0].statusId).toBe(doc.statuses.find((s) => s.name === 'Klar')?.id);
  });
});

describe('colours', () => {
  it('normalises every hex shape a model might write', () => {
    const result = validated({
      cards: [
        { title: 'Short', color: '#f00' },
        { title: 'Hashless', color: 'AB12CD' },
        { title: 'Shouty', color: '#FF00FF' },
        { title: 'Token in title case', color: 'Blue' },
      ],
    });
    expect(result.value.cards?.map((c) => c.color)).toEqual([
      '#ff0000',
      '#ab12cd',
      '#ff00ff',
      'blue',
    ]);
  });

  it('writes only colours the API will store', () => {
    const { doc } = applyImport(
      board(),
      validated({ cards: [{ title: 'A', color: '#f00' }], notes: [{ text: 'n', color: '0f0' }] })
        .value,
      'u1',
      'merge',
    );
    expect(doc.nodes.filter(isCardNode)[0].color).toBe('#ff0000');
    expect(doc.nodes.filter(isNoteNode)[0].color).toBe('#00ff00');
    for (const node of doc.nodes) {
      if (typeof node.color === 'string' && node.color.startsWith('#')) {
        expect(node.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('still drops a colour it cannot read, with a warning and no error', () => {
    const result = validated({ cards: [{ title: 'A', color: '#ff00' }] });
    expect(result.value.cards?.[0].color).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('#ff00'))).toBe(true);
  });
});

describe('shape detection', () => {
  it('keeps the cards when an empty nodes array rides along', () => {
    const result = validated({
      kartaVersion: 1,
      statuses: [{ name: 'Bygger', color: 'bronze' }],
      nodes: [],
      cards: [{ title: 'Real card one' }, { title: 'Real card two' }],
    });
    expect(result.value.cards?.map((c) => c.title)).toEqual(['Real card one', 'Real card two']);
    expect(result.warnings.some((w) => w.includes('nodes is not a Karta field'))).toBe(true);
  });

  it('keeps notes added beside an empty nodes array', () => {
    const result = validated({
      statuses: [{ name: 'Bygger' }],
      nodes: [],
      notes: [{ text: 'A sticky' }],
    });
    expect(result.value.notes?.map((n) => n.text)).toEqual(['A sticky']);
  });

  it('prefers the populated side when a board export comes back with cards added', () => {
    const exported = applyImport(
      board(),
      validated({ cards: [{ title: 'Already here' }] }).value,
      'u1',
      'merge',
    ).doc;
    const hybrid = { ...JSON.parse(exportFull(exported)), cards: [{ title: 'Added by the model' }] };

    const result = validated(hybrid);
    expect(result.value.cards?.map((c) => c.title)).toEqual(['Added by the model']);
    expect(result.warnings.some((w) => w.includes('nodes is not a Karta field'))).toBe(true);
  });

  it('still reads a real board export as a board export', () => {
    const exported = applyImport(
      board(),
      validated({ cards: [{ title: 'From the document' }] }).value,
      'u1',
      'merge',
    ).doc;
    const result = validated(JSON.parse(exportFull(exported)));
    expect(result.value.cards?.map((c) => c.title)).toEqual(['From the document']);
  });
});

describe('empty values', () => {
  const withEmpties = (): BoardDoc => ({
    ...board(),
    nodes: [
      makeCard({
        title: '',
        checklist: [makeChecklistItem({ text: '', rank: 'a0' })],
        position: { x: 0, y: 0 },
        userId: 'u1',
      }),
      makeNote({ text: '', position: { x: 280, y: 0 }, userId: 'u1' }),
    ],
  });

  it('reads back an untouched sticky note, a cleared title and an empty checklist item', () => {
    const source = withEmpties();
    for (const json of [exportPortable(source), exportFull(source)]) {
      const result = validated(JSON.parse(json));
      expect(result.value.cards?.[0].title).toBe('');
      expect(result.value.cards?.[0].checklist).toEqual([{ text: '', done: false }]);
      expect(result.value.notes?.[0].text).toBe('');

      const { doc, summary } = applyImport(board(), result.value, 'u1', 'replace');
      expect(summary.cards).toBe(1);
      expect(summary.notes).toBe(1);
      expect(doc.nodes.filter(isCardNode)[0].title).toBe('');
      expect(doc.nodes.filter(isCardNode)[0].checklist.map((i) => i.text)).toEqual(['']);
      expect(doc.nodes.filter(isNoteNode)[0].text).toBe('');
    }
  });

  it('still refuses a card with no title at all', () => {
    const result = validateImport({ cards: [{ body: 'no title' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('cards[0].title is required.');
  });
});

describe('layout', () => {
  it('keeps the grid aligned when one card carries an explicit position', () => {
    const first = applyImport(
      board(),
      validated({ cards: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }] }).value,
      'u1',
      'merge',
    ).doc;
    const nudged: BoardDoc = {
      ...first,
      nodes: first.nodes.map((n, i) => (i === 0 ? { ...n, position: { x: 0, y: 20 } } : n)),
    };

    const portable = toPortable(nudged);
    expect(portable.cards?.map((c) => c.position)).toEqual([
      { x: 0, y: 20 },
      undefined,
      undefined,
      undefined,
    ]);

    const back = applyImport(board(), validated(portable).value, 'u1', 'merge').doc;
    const at = (title: string): { x: number; y: number } | undefined =>
      back.nodes.filter(isCardNode).find((c) => c.title === title)?.position;
    expect(at('A')).toEqual({ x: 0, y: 20 });
    expect(at('B')).toEqual({ x: 280, y: 0 });
    expect(at('C')).toEqual({ x: 0, y: 180 });
    expect(at('D')).toEqual({ x: 280, y: 180 });

    const spots = back.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });
});

describe('length caps', () => {
  const long = (n: number): string => 'y'.repeat(n);

  it('shortens what the API would refuse, and says so', () => {
    const result = validated({
      board: { title: long(400), icon: long(100) },
      statuses: [{ name: long(200) }],
      labels: [{ name: long(200) }],
      cards: [
        {
          title: long(400),
          body: long(IMPORT_LIMITS.body + 50),
          checklist: [long(3000), { text: long(3000) }],
          labels: [long(200)],
        },
      ],
      notes: [{ text: long(25_000) }],
      edges: [{ from: long(400), to: long(400), label: long(500) }],
    });

    expect(result.value.board?.title).toHaveLength(IMPORT_LIMITS.title);
    expect(result.value.board?.icon).toHaveLength(IMPORT_LIMITS.icon);
    expect(result.value.statuses?.[0].name).toHaveLength(IMPORT_LIMITS.name);
    expect(result.value.labels?.[0].name).toHaveLength(IMPORT_LIMITS.name);
    const card = result.value.cards?.[0];
    expect(card?.title).toHaveLength(IMPORT_LIMITS.title);
    expect(card?.body).toHaveLength(IMPORT_LIMITS.body);
    expect(card?.labels?.[0]).toHaveLength(IMPORT_LIMITS.name);
    expect(card?.checklist?.map((i) => (typeof i === 'string' ? i : i.text).length)).toEqual([
      IMPORT_LIMITS.checklistText,
      IMPORT_LIMITS.checklistText,
    ]);
    expect(result.value.notes?.[0].text).toHaveLength(IMPORT_LIMITS.noteText);
    expect(result.value.edges?.[0].label).toHaveLength(IMPORT_LIMITS.edgeLabel);
    expect(result.warnings.some((w) => w.includes('cards[0].title is longer than 300'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('board.icon is longer than 64'))).toBe(true);
  });

  it('produces a document inside every limit the API measures', () => {
    const { doc } = applyImport(
      board(),
      validated({
        board: { title: long(400), icon: long(100) },
        statuses: [{ name: long(200) }],
        cards: [{ title: long(400), checklist: [long(3000)], labels: [long(200)] }],
        notes: [{ text: long(25_000) }],
      }).value,
      'u1',
      'merge',
    );

    expect(doc.title.length).toBeLessThanOrEqual(IMPORT_LIMITS.title);
    expect(doc.icon?.length ?? 0).toBeLessThanOrEqual(IMPORT_LIMITS.icon);
    for (const status of doc.statuses) expect(status.name.length).toBeLessThanOrEqual(IMPORT_LIMITS.name);
    for (const label of doc.labels) expect(label.name.length).toBeLessThanOrEqual(IMPORT_LIMITS.name);
    for (const node of doc.nodes) {
      if (isCardNode(node)) {
        expect(node.title.length).toBeLessThanOrEqual(IMPORT_LIMITS.title);
        expect(node.body.length).toBeLessThanOrEqual(IMPORT_LIMITS.body);
        for (const item of node.checklist) {
          expect(item.text.length).toBeLessThanOrEqual(IMPORT_LIMITS.checklistText);
        }
      }
      if (isNoteNode(node)) expect(node.text.length).toBeLessThanOrEqual(IMPORT_LIMITS.noteText);
    }
  });

  it('still resolves an arrow that names a shortened title', () => {
    const { summary } = applyImport(
      board(),
      validated({
        cards: [{ title: long(400) }, { title: 'Role check' }],
        edges: [{ from: 'Role check', to: long(400) }],
      }).value,
      'u1',
      'merge',
    );
    expect(summary.edges).toBe(1);
    expect(summary.warnings).toHaveLength(0);
  });
});

describe('keys', () => {
  it('never lets a note key shadow a card key', () => {
    const result = validated({
      cards: [
        { key: 'a', title: 'Card A' },
        { key: 'b', title: 'Card B' },
      ],
      notes: [{ key: 'a', text: 'Note A' }],
      edges: [{ from: 'b', to: 'a' }],
    });
    expect(result.warnings.some((w) => w.includes('notes[0].key "a" is already used'))).toBe(true);

    const { doc, summary } = applyImport(board(), result.value, 'u1', 'merge');
    const cardA = doc.nodes.filter(isCardNode).find((c) => c.title === 'Card A');
    expect(summary.edges).toBe(1);
    expect(doc.edges[0].target).toBe(cardA?.id);
  });

  it('gives a repeated card key to the first card that claimed it', () => {
    const result = validated({
      cards: [
        { key: 'a', title: 'First' },
        { key: 'a', title: 'Second' },
        { key: 'b', title: 'Third' },
      ],
      edges: [{ from: 'b', to: 'a' }],
    });
    expect(result.warnings.some((w) => w.includes('cards[1].key "a" is already used'))).toBe(true);
    const { doc } = applyImport(board(), result.value, 'u1', 'merge');
    const first = doc.nodes.filter(isCardNode).find((c) => c.title === 'First');
    expect(doc.edges[0].target).toBe(first?.id);
  });
});

describe('labels on a card', () => {
  it('gives a card one label id per label', () => {
    const result = validated({ cards: [{ title: 'A', labels: ['bug', 'BUG', 'Bug'] }] });
    expect(result.value.cards?.[0].labels).toEqual(['bug']);
    expect(result.warnings.some((w) => w.includes('appears twice on the same card'))).toBe(true);

    const { doc, summary } = applyImport(board(), result.value, 'u1', 'merge');
    expect(doc.labels).toHaveLength(1);
    expect(doc.nodes.filter(isCardNode)[0].labelIds).toEqual([doc.labels[0].id]);
    expect(summary.labelsCreated).toEqual(['bug']);
  });
});

describe('texts and shapes', () => {
  it('reads both lists, in full and in their bare forms', () => {
    const result = validated({
      texts: [
        { key: 'h', text: 'Phase one', fontSize: 32, align: 'center', weight: 'bold', color: 'teal' },
        'Phase two',
      ],
      shapes: [{ key: 'd', shape: 'diamond', label: 'Ready?', fill: 'blue' }, 'cloud'],
    });

    expect(result.value.texts).toEqual([
      { key: 'h', text: 'Phase one', fontSize: 32, align: 'center', weight: 'bold', color: 'teal' },
      { text: 'Phase two' },
    ]);
    expect(result.value.shapes).toEqual([
      { key: 'd', shape: 'diamond', label: 'Ready?', fill: 'blue' },
      { shape: 'cloud' },
    ]);
    expect(result.warnings).toHaveLength(0);
  });

  it('creates the nodes and lets arrows point at them by key', () => {
    const result = validated({
      cards: [{ key: 'c', title: 'Sign-in' }],
      texts: [{ key: 'h', text: 'Phase one', weight: 'bold' }],
      shapes: [{ key: 'd', shape: 'diamond', label: 'Ready?' }],
      edges: [{ from: 'd', to: 'c', semantic: 'depends' }],
    });
    const { doc, summary } = applyImport(board(), result.value, 'u1', 'merge');

    expect([summary.texts, summary.shapes, summary.edges]).toEqual([1, 1, 1]);

    const text = doc.nodes.filter(isTextNode)[0];
    expect(text).toMatchObject({ text: 'Phase one', weight: 'bold', align: 'left' });
    expect(text.fontSize).toBe(DEFAULT_TEXT_SIZE);

    const shape = doc.nodes.filter(isShapeNode)[0];
    expect(shape).toMatchObject({ shape: 'diamond', label: 'Ready?', fill: null, stroke: null });

    expect(doc.edges[0].source).toBe(shape.id);
    expect(doc.edges[0].target).toBe(doc.nodes.filter(isCardNode)[0].id);
  });

  it('degrades a value it does not understand and fails a missing shape', () => {
    const loose = validated({
      texts: [{ text: 'Big', fontSize: 900, align: 'justified' }],
      shapes: [{ shape: 'octagon' }],
    });
    expect(loose.value.texts?.[0]).toEqual({ text: 'Big' });
    expect(loose.value.shapes?.[0]).toEqual({ shape: 'rectangle' });
    expect(loose.warnings.some((w) => w.includes('texts[0].fontSize'))).toBe(true);
    expect(loose.warnings.some((w) => w.includes('texts[0].align "justified"'))).toBe(true);
    expect(loose.warnings.some((w) => w.includes('shapes[0].shape "octagon"'))).toBe(true);

    const missing = validateImport({ shapes: [{ label: 'nameless' }] });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors).toContain('shapes[0].shape is required.');
  });

  it('shares one key namespace with the cards and notes', () => {
    const result = validated({
      cards: [
        { key: 'a', title: 'Card A' },
        { key: 'b', title: 'Card B' },
      ],
      texts: [{ key: 'a', text: 'Text A' }],
      shapes: [{ key: 'a', shape: 'ellipse' }],
      edges: [{ from: 'b', to: 'a' }],
    });
    expect(result.warnings.some((w) => w.includes('texts[0].key "a" is already used'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('shapes[0].key "a" is already used'))).toBe(true);

    // The card claimed "a" first, so the arrow lands on it and not on the
    // text or the shape that asked for the same handle.
    const { doc } = applyImport(board(), result.value, 'u1', 'merge');
    const cardA = doc.nodes.filter(isCardNode).find((c) => c.title === 'Card A');
    expect(doc.edges[0].target).toBe(cardA?.id);
  });

  it('counts a board of nothing but shapes as something to import', () => {
    expect(validateImport({ shapes: ['diamond'] }).ok).toBe(true);
    expect(validateImport({ texts: ['A heading'] }).ok).toBe(true);
  });
});

describe('the whole round trip', () => {
  const BOARD_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const MEDIA_ID = '01HYYYYYYYYYYYYYYYYYYYYYYY';

  const everything = {
    kartaVersion: 1,
    board: { title: 'Karta', icon: '📐' },
    statuses: [
      { name: 'Bygger', color: 'bronze' },
      { name: 'Slutfört', color: 'teal', isDone: true },
    ],
    labels: [{ name: 'infra', color: 'copper' }],
    cards: [
      {
        key: 'a',
        title: 'Sign-in with Azure AD',
        body: '# why\n\n- one\n- two\n',
        status: 'Bygger',
        labels: ['infra'],
        checklist: ['Register the app', { text: 'Wire the redirect', done: true }],
        color: 'blue',
        due: '2026-04-30',
        collapsed: true,
      },
      {
        key: 'b',
        title: 'Role check on every route',
        status: 'Slutfört',
        color: '#AB12CD',
        due: '2026-05-01T12:30:00.000Z',
      },
      { key: 'c', title: '' },
    ],
    notes: [
      { key: 'n', text: 'Remember the redirect URI', color: 'straw' },
      { key: 'm', text: '' },
    ],
    texts: [
      { key: 'h', text: 'Phase one', fontSize: 32, align: 'center', weight: 'bold', color: 'teal' },
      { text: '' },
    ],
    shapes: [
      { key: 'd', shape: 'diamond', label: 'Ready?', fill: 'blue', stroke: '#AB12CD' },
      { shape: 'cloud' },
    ],
    edges: [
      { from: 'b', to: 'a', semantic: 'depends', label: 'needs' },
      { from: 'a', to: 'n' },
      { from: 'c', to: 'b', semantic: 'blocks' },
      { from: 'm', to: 'c', semantic: 'derives' },
      { from: 'd', to: 'h' },
    ],
  };

  /** Every node kind, every edge semantic, and one card off its grid slot. */
  const richBoard = (): BoardDoc => {
    const built = applyImport(board(), validated(everything).value, 'u1', 'merge').doc;
    const doc = JSON.parse(JSON.stringify(built)) as BoardDoc;
    const image = makeImageNode({
      mediaId: MEDIA_ID,
      naturalSize: { w: 800, h: 600 },
      position: { x: 900, y: 0 },
      userId: 'u1',
    });
    doc.nodes.push(
      image,
      makeGroup({ title: 'Frame', position: { x: 900, y: 400 }, userId: 'u1' }),
      makeBoardLink({ targetBoardId: BOARD_ID, position: { x: 900, y: 800 }, userId: 'u1' }),
    );
    doc.edges.push(makeEdge({ source: doc.nodes[0].id, target: image.id }));
    doc.nodes[0].position = { x: 0, y: 20 };
    return doc;
  };

  it('reproduces everything the portable format carries', () => {
    const source = richBoard();
    const result = validated(JSON.parse(exportPortable(source)));
    const { doc, summary } = applyImport(board(), result.value, 'u1', 'replace');

    expect(toPortable(doc)).toEqual(toPortable(source));

    expect(summary.cards).toBe(3);
    expect(summary.notes).toBe(2);
    expect(summary.texts).toBe(2);
    expect(summary.shapes).toBe(2);
    expect(summary.edges).toBe(5); // the arrow onto the image cannot travel
    expect(summary.warnings).toHaveLength(0);

    expect(doc.title).toBe('Karta');
    expect(doc.icon).toBe('📐');
    expect(doc.labels.map((l) => [l.name, l.color])).toEqual([['infra', 'copper']]);
    expect(doc.statuses.find((s) => s.name === 'Slutfört')).toMatchObject({
      color: 'teal',
      isDone: true,
    });

    const cards = doc.nodes.filter(isCardNode);
    const signIn = cards[0];
    expect(signIn.title).toBe('Sign-in with Azure AD');
    expect(signIn.body).toBe('# why\n\n- one\n- two\n');
    expect(signIn.color).toBe('blue');
    expect(signIn.collapsed).toBe(true);
    expect(signIn.dueDate).toBe('2026-04-30T00:00:00.000Z');
    expect(signIn.statusId).toBe(doc.statuses.find((s) => s.name === 'Bygger')?.id);
    expect(signIn.labelIds).toEqual([doc.labels[0].id]);
    expect(signIn.checklist.map((i) => [i.text, i.done])).toEqual([
      ['Register the app', false],
      ['Wire the redirect', true],
    ]);
    expect(signIn.position).toEqual({ x: 0, y: 20 });
    expect(cards[1].color).toBe('#ab12cd');
    expect(cards[1].dueDate).toBe('2026-05-01T12:30:00.000Z');
    expect(cards[2].title).toBe('');

    expect(doc.nodes.filter(isNoteNode).map((n) => n.text)).toEqual([
      'Remember the redirect URI',
      '',
    ]);

    const heading = doc.nodes.filter(isTextNode)[0];
    expect(heading).toMatchObject({
      text: 'Phase one',
      fontSize: 32,
      align: 'center',
      weight: 'bold',
      color: 'teal',
    });
    const diamond = doc.nodes.filter(isShapeNode)[0];
    expect(diamond).toMatchObject({
      shape: 'diamond',
      label: 'Ready?',
      fill: 'blue',
      stroke: '#ab12cd',
    });
    expect(doc.nodes.filter(isShapeNode)[1]).toMatchObject({ shape: 'cloud', fill: null });
    expect(doc.edges.find((e) => e.source === diamond.id)?.target).toBe(heading.id);

    expect(new Set(doc.edges.map((e) => e.semantic))).toEqual(
      new Set(['depends', 'relates', 'blocks', 'derives']),
    );
    expect(doc.edges.find((e) => e.semantic === 'depends')?.label).toBe('needs');

    const spots = doc.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('reads its own full backup back in', () => {
    const source = richBoard();
    const result = validated(JSON.parse(exportFull(source)));
    expect(result.warnings.some((w) => w.includes('cannot travel in the portable format'))).toBe(
      true,
    );

    const { doc, summary } = applyImport(board(), result.value, 'u1', 'replace');
    expect(summary.cards).toBe(3);
    expect(summary.notes).toBe(2);
    expect(summary.texts).toBe(2);
    expect(summary.shapes).toBe(2);
    expect(summary.edges).toBe(5);
    expect(toPortable(doc)).toEqual(toPortable(source));
  });
});
