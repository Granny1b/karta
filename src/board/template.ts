import type { BoardDoc, BoardNode, Edge, Id } from '@/domain/board';
import { DEFAULT_NODE_SIZE } from '@/domain/board';
import { api } from '@/lib/api';
import { nowIso } from '@/lib/format';
import { rankBetween } from '@/lib/ranks';
import { makeBoardLink, makeCard, makeChecklistItem, makeEdge, makeNote } from '@/state/factories';

/**
 * The starter template (Appendix A): a root board "MMORPG" holding the pitch and
 * five board links, and the five child boards with their first cards and the
 * suggested `depends` / `derives` arrows.
 *
 * It is built entirely through the public API — create a board, fill it, save it
 * — so it behaves exactly like a person doing the same thing by hand.
 */

const PITCH =
  'A small co-op MMORPG in Unity. This board is the build order: systems first, then the classes and the world that come out of them.';

interface CardSpec {
  title: string;
  body?: string;
  checklist?: string[];
}

interface EdgeSpec {
  from: string; // a card title on the same board
  to: string;
  semantic: 'depends' | 'derives';
}

interface ChildSpec {
  title: string;
  cards: CardSpec[];
  edges: EdgeSpec[];
}

const CHILDREN: ChildSpec[] = [
  {
    title: 'Systems',
    cards: [
      {
        title: 'Character controller',
        body: 'Movement, camera and the animation state machine. This is where the game starts to feel like something.',
      },
      {
        title: 'Networking (MMORPG KIT)',
        body: 'The spine. Nothing that touches shared state can be built before this is settled.',
      },
      { title: 'Persistence', body: 'Characters, inventories and world state that survive a restart.' },
      { title: 'Instancing', body: 'Dungeons and zone instances: when to spawn one, when to tear it down.' },
      { title: 'Inventory', body: 'Items, stacks, equipment slots, and what the server considers authoritative.' },
    ],
    // `depends` points away from Networking, at everything that cannot be built
    // before it — that convention is what makes the board a build order.
    edges: [
      { from: 'Networking (MMORPG KIT)', to: 'Persistence', semantic: 'depends' },
      { from: 'Networking (MMORPG KIT)', to: 'Instancing', semantic: 'depends' },
      { from: 'Networking (MMORPG KIT)', to: 'Inventory', semantic: 'depends' },
    ],
  },
  {
    title: 'Classes & spells',
    cards: [
      {
        title: 'Warrior',
        body: 'Melee, holds the line.',
        checklist: [
          'Charge',
          'Shield slam',
          'Cleave',
          'Taunt',
          'Rend',
          'Battle shout',
          'Last stand',
          'Execute',
        ],
      },
      {
        title: 'Mage',
        body: 'Ranged burst, no armour.',
        checklist: [
          'Frostbolt',
          'Fireball',
          'Blink',
          'Arcane shield',
          'Chain lightning',
          'Polymorph',
          'Meteor',
          'Mana surge',
        ],
      },
      {
        title: 'Ranger',
        body: 'Sustained damage at range, plus a pet.',
        checklist: [
          'Aimed shot',
          'Multishot',
          'Snare trap',
          'Camouflage',
          'Call pet',
          'Volley',
          'Disengage',
          "Hunter's mark",
        ],
      },
      {
        title: 'Cleric',
        body: 'Healing first, damage when there is room.',
        checklist: [
          'Heal',
          'Renew',
          'Smite',
          'Sanctuary',
          'Dispel',
          'Group heal',
          'Resurrect',
          'Divine shield',
        ],
      },
    ],
    edges: [],
  },
  {
    title: 'World',
    cards: [
      { title: 'Zone blockouts', body: 'Grey-box every zone before a single asset is imported.' },
      { title: 'Navmesh', body: 'Bake, verify, and decide how much of it is generated at runtime.' },
      { title: 'Spawns', body: 'Spawn tables, respawn timers, density per zone.' },
      { title: 'Points of interest', body: 'The reasons to walk somewhere: camps, ruins, vendors, bosses.' },
    ],
    edges: [
      { from: 'Zone blockouts', to: 'Navmesh', semantic: 'depends' },
      { from: 'Navmesh', to: 'Spawns', semantic: 'depends' },
    ],
  },
  {
    title: 'Content pipeline',
    cards: [
      { title: 'Asset sources', body: 'Where art comes from, what is bought, what is made.' },
      { title: 'Import settings', body: 'Presets per asset type so nothing is imported twice by hand.' },
      { title: 'Naming conventions', body: 'One naming scheme, written down, applied before the library grows.' },
    ],
    edges: [{ from: 'Asset sources', to: 'Import settings', semantic: 'depends' }],
  },
  {
    // Deliberately empty (Appendix A): it fills itself as things go wrong.
    title: 'Bugs & friction',
    cards: [],
    edges: [],
  },
];

const CARD = DEFAULT_NODE_SIZE.card;
const LINK = DEFAULT_NODE_SIZE.boardLink;
const COLUMN_GAP = 60;
const ROW_GAP = 60;
const PER_ROW = 3;

/** A strictly increasing sequence of fractional ranks. */
function rankSequence(count: number): string[] {
  const out: string[] = [];
  let previous: string | null = null;
  for (let i = 0; i < count; i += 1) {
    previous = rankBetween(previous, null);
    out.push(previous);
  }
  return out;
}

function buildChildNodes(spec: ChildSpec, statusId: Id | null, userId: string): { nodes: BoardNode[]; edges: Edge[] } {
  const ranks = rankSequence(spec.cards.length);
  const byTitle = new Map<string, Id>();

  const nodes: BoardNode[] = spec.cards.map((card, index) => {
    const column = index % PER_ROW;
    const row = Math.floor(index / PER_ROW);
    const itemRanks = rankSequence(card.checklist?.length ?? 0);
    const node = makeCard({
      userId,
      title: card.title,
      body: card.body ?? '',
      statusId,
      rank: ranks[index] ?? rankBetween(null, null),
      position: { x: column * (CARD.w + COLUMN_GAP), y: row * (CARD.h + ROW_GAP) },
      checklist: (card.checklist ?? []).map((text, itemIndex) =>
        makeChecklistItem({ text, rank: itemRanks[itemIndex] }),
      ),
    });
    byTitle.set(card.title, node.id);
    return node;
  });

  const edges: Edge[] = [];
  for (const edge of spec.edges) {
    const source = byTitle.get(edge.from);
    const target = byTitle.get(edge.to);
    if (!source || !target) continue;
    edges.push(makeEdge({ source, target, semantic: edge.semantic, routing: 'smoothstep' }));
  }

  return { nodes, edges };
}

/** Replaces the content of a freshly created board, keeping its identity and ACL. */
function fill(doc: BoardDoc, nodes: BoardNode[], edges: Edge[]): BoardDoc {
  return { ...doc, nodes, edges, updatedAt: nowIso() };
}

export interface StarterProject {
  rootId: Id;
  childIds: Id[];
}

/**
 * Creates the whole template and returns the root board's id. Every step is a
 * real API call, so a failure part-way through leaves the boards that were
 * already created — the error message says so rather than pretending otherwise.
 */
export async function createStarterProject(options: {
  userId: string;
  parentBoardId?: Id | null;
  onProgress?: (message: string) => void;
}): Promise<StarterProject> {
  const { userId, parentBoardId = null, onProgress } = options;

  onProgress?.('Creating the MMORPG board…');
  const root = await api.createBoard({ title: 'MMORPG', parentBoardId });

  const links: BoardNode[] = [];
  const childIds: Id[] = [];
  const linkByTitle = new Map<string, Id>();

  const note = makeNote({
    userId,
    text: PITCH,
    position: { x: 0, y: 0 },
    size: { w: CHILDREN.length * (LINK.w + COLUMN_GAP) - COLUMN_GAP, h: 96 },
  });

  for (const [index, spec] of CHILDREN.entries()) {
    onProgress?.(`Creating ${spec.title}…`);
    const child = await api.createBoard({ title: spec.title, parentBoardId: root.doc.id });
    childIds.push(child.doc.id);

    const firstStatus = [...child.doc.statuses].sort((a, b) => a.order - b.order)[0] ?? null;
    const { nodes, edges } = buildChildNodes(spec, firstStatus?.id ?? null, userId);
    await api.putBoard(child.doc.id, fill(child.doc, nodes, edges), child.etag, []);

    const link = makeBoardLink({
      userId,
      targetBoardId: child.doc.id,
      cachedTitle: spec.title,
      cachedCounts: { total: spec.cards.length, done: 0 },
      position: { x: index * (LINK.w + COLUMN_GAP), y: note.size.h + 100 },
    });
    links.push(link);
    linkByTitle.set(spec.title, link.id);
  }

  // The one convention worth shipping with the template: `derives` from the
  // systems to the classes that came out of them, `depends` for build order.
  const rootEdges: Edge[] = [];
  const connect = (from: string, to: string, semantic: 'depends' | 'derives', back = false): void => {
    const source = linkByTitle.get(from);
    const target = linkByTitle.get(to);
    if (!source || !target) return;
    rootEdges.push(
      makeEdge({
        source,
        target,
        semantic,
        routing: 'smoothstep',
        sourceHandle: back ? 'left' : 'right',
        targetHandle: back ? 'right' : 'left',
      }),
    );
  };
  connect('Systems', 'Classes & spells', 'derives');
  connect('Classes & spells', 'World', 'depends');
  connect('Content pipeline', 'World', 'depends', true);

  onProgress?.('Laying out the MMORPG board…');
  await api.putBoard(root.doc.id, fill(root.doc, [note, ...links], rootEdges), root.etag, []);

  return { rootId: root.doc.id, childIds };
}
