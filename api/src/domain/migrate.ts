/**
 * Lazy forward migration, applied on every read from storage.
 *
 * A board document is written once and read many times, so the cheapest place
 * to absorb a schema change is the read path: no batch job, no downtime, no
 * "migrate everything" script that has to be right the first time. A document
 * is rewritten in its new shape the next time the user saves it.
 *
 * ## Adding schema version 2
 *
 * 1. Bump `SCHEMA_VERSION` in `src/domain/board.ts` and update `BoardDoc`.
 * 2. Write `function v1ToV2(raw: RawDoc): RawDoc` below — pure, total, no I/O.
 * 3. Add `[1, v1ToV2]` to `MIGRATIONS`.
 *
 * The loop then walks any stored document forward one version at a time.
 * Nothing else changes: `migrate` already throws on versions from the future,
 * which is the correct behaviour when an old deployment meets a new document.
 */

import type { BoardDoc } from '../../../src/domain/board.js';
import { SCHEMA_VERSION } from '../../../src/domain/board.js';

type RawDoc = Record<string, unknown>;

/** `version` -> function producing the shape of `version + 1`. */
const MIGRATIONS: ReadonlyMap<number, (raw: RawDoc) => RawDoc> = new Map();

const isRecord = (v: unknown): v is RawDoc => typeof v === 'object' && v !== null && !Array.isArray(v);

const arrayOr = (v: unknown, fallback: unknown[]): unknown[] => (Array.isArray(v) ? v : fallback);

const stringOr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

const numberOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

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

  const declared = raw['schemaVersion'];
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1) {
    throw new Error(`Stored board document has an invalid schemaVersion: ${JSON.stringify(declared)}`);
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

  return normalise(doc);
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
    title: stringOr(raw['title'], 'Namnlös tavla'),
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
