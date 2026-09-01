/**
 * Lazy forward migration, applied on every read from storage.
 *
 * A board document is written once and read many times, so the cheapest place
 * to absorb a schema change is the read path: no batch job, no downtime, no
 * "migrate everything" script that has to be right the first time. A document
 * is rewritten in its new shape the next time the user saves it.
 *
 * ## Adding a schema version
 *
 * 1. Bump `SCHEMA_VERSION` in `src/domain/board.ts` and update `BoardDoc`.
 * 2. Write `function vNToVNext(raw: RawDoc): RawDoc` below — pure, total, no I/O.
 * 3. Add `[N, vNToVNext]` to `MIGRATIONS`.
 *
 * The loop then walks any stored document forward one version at a time.
 * Nothing else changes: `migrate` already throws on versions from the future,
 * which is the correct behaviour when an old deployment meets a new document.
 *
 * The write path shares the walk through {@link upgradeToCurrent} rather than
 * demanding the current version outright. A client holds documents too — in
 * its write-ahead log, across a deploy — and an API that can read a version it
 * refuses to be handed back turns that log into a permanent save failure.
 */

import type { BoardDoc } from '../../../src/domain/board.js';
import { SCHEMA_VERSION } from '../../../src/domain/board.js';
import { DEFAULT_BOARD_TITLE } from './defaults.js';

type RawDoc = Record<string, unknown>;

/**
 * 1 → 2: the `text` and `shape` nodes (spec 5.2). Purely additive — every node
 * kind that existed under 1 has exactly the same shape under 2 — so there is
 * nothing to rewrite and this step is deliberately the identity. It is
 * registered rather than special-cased so the version loop stays one rule: a
 * document declaring 1 walks through here and `normalise` stamps it as 2.
 */
const v1ToV2 = (raw: RawDoc): RawDoc => raw;

/**
 * 2 → 3: the default statuses are English.
 *
 * The board shipped with Swedish column names (Idé → Planerad → Bygger →
 * Testar → Klar) while the rest of the UI was English — spec Appendix B
 * question 1, now answered: English throughout. Existing boards carry the old
 * names in their documents, so a default set left untouched would stay Swedish
 * forever and every board made from the starter template would need renaming by
 * hand.
 *
 * Only an exact match of one of the five original names is renamed. A status
 * the owner has already renamed does not match and is left alone, and neither
 * is a status they deliberately named something else. Colour, order, isDone and
 * id are untouched, so cards keep their column.
 */
const V2_STATUS_NAMES: ReadonlyMap<string, string> = new Map([
  ['Idé', 'Idea'],
  ['Planerad', 'Planned'],
  ['Bygger', 'Building'],
  ['Testar', 'Testing'],
  ['Klar', 'Done'],
]);

const v2ToV3 = (raw: RawDoc): RawDoc => {
  const statuses = raw['statuses'];
  if (!Array.isArray(statuses)) return raw;

  let renamed = false;
  const next = statuses.map((status) => {
    if (!isRecord(status)) return status;
    const name = status['name'];
    if (typeof name !== 'string') return status;
    const english = V2_STATUS_NAMES.get(name);
    if (english === undefined) return status;
    renamed = true;
    return { ...status, name: english };
  });

  return renamed ? { ...raw, statuses: next } : raw;
};

/**
 * 3 → 4: arrows are stepped.
 *
 * `bezier` was the default routing, and a curve makes it impossible to see
 * whether two nodes are actually aligned — the whole point of an arrow between
 * them. Stepped is the default now, and boards already drawn carry the old
 * value on every edge, so they would keep curving forever.
 *
 * Only an edge still holding the old default is changed. An edge explicitly set
 * to `straight` was a choice and is left alone. A `bezier` that was chosen
 * deliberately is indistinguishable from one that was never touched, and it is
 * one click on the edge toolbar to put back.
 */
const v3ToV4 = (raw: RawDoc): RawDoc => {
  const edges = raw['edges'];
  if (!Array.isArray(edges)) return raw;

  let changed = false;
  const next = edges.map((edge) => {
    if (!isRecord(edge) || edge['routing'] !== 'bezier') return edge;
    changed = true;
    return { ...edge, routing: 'smoothstep' };
  });

  return changed ? { ...raw, edges: next } : raw;
};

/** `version` -> function producing the shape of `version + 1`. */
const MIGRATIONS: ReadonlyMap<number, (raw: RawDoc) => RawDoc> = new Map([
  [1, v1ToV2],
  [2, v2ToV3],
  [3, v3ToV4],
]);

const isRecord = (v: unknown): v is RawDoc => typeof v === 'object' && v !== null && !Array.isArray(v);

const arrayOr = (v: unknown, fallback: unknown[]): unknown[] => (Array.isArray(v) ? v : fallback);

const stringOr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

const numberOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Walk a document forward to the current schema and stamp the version, without
 * filling anything in.
 *
 * This is the tolerance the read and the write path share: whatever versions
 * this build can migrate, it can also be handed. `migrate` calls it and then
 * fills in what storage may be missing; `validate.ts` calls it and then checks
 * the result strictly, so a client document is upgraded before it is judged
 * and never judged against a version it was not written under.
 *
 * Throws when the version is missing, is not a whole number, or comes from a
 * deployment newer than this one.
 */
export function upgradeToCurrent(raw: RawDoc): RawDoc {
  const declared = raw['schemaVersion'];
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1) {
    throw new Error(`Board document has an invalid schemaVersion: ${JSON.stringify(declared)}`);
  }
  if (declared > SCHEMA_VERSION) {
    throw new Error(
      `Board document is schema version ${declared}, but this build understands at most ${SCHEMA_VERSION}. Deploy the newer API.`,
    );
  }

  let doc = raw;
  for (let version = declared; version < SCHEMA_VERSION; version++) {
    const step = MIGRATIONS.get(version);
    if (!step) {
      throw new Error(`No migration registered from schema version ${version} to ${version + 1}.`);
    }
    doc = step(doc);
  }

  // A step may legitimately be the identity, so the stamp is applied here and
  // not left to the steps. The copy also keeps the caller's input untouched.
  return { ...doc, schemaVersion: SCHEMA_VERSION };
}

/**
 * Bring a stored document up to the current schema version.
 *
 * Throws when the input is not an object or carries a version this build does
 * not understand. Missing optional collections are filled in defensively: a
 * document written before `media` existed, or hand-edited in the portal, must
 * not crash a read.
 */
export function migrate(raw: unknown): BoardDoc {
  if (!isRecord(raw)) {
    throw new Error('Stored board document is not a JSON object.');
  }

  return normalise(upgradeToCurrent(raw));
}

/**
 * Fill in anything optional that may be absent from an older or hand-edited
 * document. This is not a validator — a document that reaches here is trusted
 * storage, not client input. See `validate.ts` for the write path.
 */
function normalise(raw: RawDoc): BoardDoc {
  const acl = isRecord(raw['acl']) ? raw['acl'] : {};
  const viewport = isRecord(raw['viewport']) ? raw['viewport'] : {};

  const doc: BoardDoc = {
    schemaVersion: SCHEMA_VERSION,
    id: stringOr(raw['id'], ''),
    parentBoardId: typeof raw['parentBoardId'] === 'string' ? raw['parentBoardId'] : null,
    title: stringOr(raw['title'], DEFAULT_BOARD_TITLE),
    icon: typeof raw['icon'] === 'string' ? raw['icon'] : null,
    createdAt: stringOr(raw['createdAt'], new Date(0).toISOString()),
    updatedAt: stringOr(raw['updatedAt'], stringOr(raw['createdAt'], new Date(0).toISOString())),
    deletedAt: typeof raw['deletedAt'] === 'string' ? raw['deletedAt'] : null,
    acl: {
      ownerId: stringOr(acl['ownerId'], ''),
      editorIds: arrayOr(acl['editorIds'], []).filter((v): v is string => typeof v === 'string'),
      viewerIds: arrayOr(acl['viewerIds'], []).filter((v): v is string => typeof v === 'string'),
    },
    viewport: {
      x: numberOr(viewport['x'], 0),
      y: numberOr(viewport['y'], 0),
      zoom: numberOr(viewport['zoom'], 1),
    },
    statuses: arrayOr(raw['statuses'], []) as BoardDoc['statuses'],
    labels: arrayOr(raw['labels'], []) as BoardDoc['labels'],
    nodes: arrayOr(raw['nodes'], []) as BoardDoc['nodes'],
    edges: arrayOr(raw['edges'], []) as BoardDoc['edges'],
    media: arrayOr(raw['media'], []) as BoardDoc['media'],
  };

  if (!doc.id) {
    throw new Error('Stored board document has no id.');
  }
  return doc;
}
