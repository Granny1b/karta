import { Fragment, useMemo, useState, type DragEvent } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import type { CardNode, ColorToken, Id } from '@/domain/board';
import { colorValue } from '@/lib/colors';
import { byRank, rankAfterAll, rankBetween } from '@/lib/ranks';
import { makeCard } from '@/state/factories';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { cardNodes, matchesFilter } from '@/state/selectors';
import FilterBar, { NoResults } from '@/kanban/FilterBar';
import KanbanCard from '@/kanban/KanbanCard';
import StatusEditor from '@/kanban/StatusEditor';
import { projectNestedCard, useNestedCards } from '@/kanban/includeNested';

/**
 * The board as columns (spec 7.4). The same nodes as the canvas, projected:
 * only cards appear, dragging between columns sets `statusId`, dragging within
 * one sets `rank`, and no canvas position is ever touched.
 */

const NO_STATUS = ''; // the column key for `statusId: null`

interface Column {
  key: string;
  statusId: Id | null;
  name: string;
  color: ColorToken | null;
}

interface NestedEntry {
  card: CardNode;
  boardId: Id;
  boardTitle: string;
}

interface DropTarget {
  column: string;
  index: number;
}

export default function KanbanView(): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const boardId = useBoardStore((s) => s.boardId);
  const updateNode = useBoardStore((s) => s.updateNode);
  const addNode = useBoardStore((s) => s.addNode);
  const openEditor = useUiStore((s) => s.openEditor);
  const filter = useUiStore((s) => s.filter);
  const filterActive = useUiStore((s) => s.filterActive());

  const [statusEditorOpen, setStatusEditorOpen] = useState(false);
  const [includeNested, setIncludeNested] = useState(false);
  const [dragCardId, setDragCardId] = useState<Id | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const nested = useNestedCards(includeNested, boardId);

  const statuses = useMemo(() => [...(doc?.statuses ?? [])].sort((a, b) => a.order - b.order), [doc?.statuses]);

  const columns = useMemo<Column[]>(
    () => [
      { key: NO_STATUS, statusId: null, name: 'No status', color: null },
      ...statuses.map((status) => ({
        key: status.id,
        statusId: status.id,
        name: status.name,
        color: status.color,
      })),
    ],
    [statuses],
  );

  // A card pointing at a status that no longer exists belongs in "No status".
  const knownStatusIds = useMemo(() => new Set(statuses.map((s) => s.id)), [statuses]);
  const columnKeyOf = useMemo(
    () => (statusId: Id | null): string => (statusId !== null && knownStatusIds.has(statusId) ? statusId : NO_STATUS),
    [knownStatusIds],
  );

  /** Every card of the board, by column — unfiltered, for rank arithmetic. */
  const allByColumn = useMemo(() => {
    const map = new Map<string, CardNode[]>();
    for (const card of cardNodes(doc)) {
      const key = columnKeyOf(card.statusId);
      const list = map.get(key);
      if (list) list.push(card);
      else map.set(key, [card]);
    }
    for (const list of map.values()) list.sort(byRank);
    return map;
  }, [doc, columnKeyOf]);

  const visibleByColumn = useMemo(() => {
    const map = new Map<string, CardNode[]>();
    for (const [key, list] of allByColumn) {
      map.set(
        key,
        list.filter((card) => matchesFilter(card, filter)),
      );
    }
    return map;
  }, [allByColumn, filter]);

  const nestedByColumn = useMemo(() => {
    const map = new Map<string, NestedEntry[]>();
    if (!doc) return map;
    for (const entry of nested.cards) {
      const projected = projectNestedCard(entry, doc.statuses, doc.labels);
      if (!matchesFilter(projected, filter)) continue;
      const key = columnKeyOf(projected.statusId);
      const item: NestedEntry = { card: projected, boardId: entry.boardId, boardTitle: entry.boardTitle };
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    for (const list of map.values()) list.sort((a, b) => byRank(a.card, b.card));
    return map;
  }, [nested.cards, doc, filter, columnKeyOf]);

  const visibleCount = useMemo(() => {
    let total = 0;
    for (const list of visibleByColumn.values()) total += list.length;
    for (const list of nestedByColumn.values()) total += list.length;
    return total;
  }, [visibleByColumn, nestedByColumn]);

  const endDrag = (): void => {
    setDragCardId(null);
    setDropTarget(null);
  };

  const applyDrop = (column: Column): void => {
    const cardId = dragCardId;
    const target = dropTarget;
    endDrag();
    if (cardId === null || target === null || target.column !== column.key || !doc) return;

    const source = doc.nodes.find((node) => node.id === cardId);
    if (!source || source.kind !== 'card') return;

    const shown = visibleByColumn.get(column.key) ?? [];
    const rest = shown.filter((card) => card.id !== cardId);
    const from = shown.findIndex((card) => card.id === cardId);
    const index = from >= 0 && from < target.index ? target.index - 1 : target.index;
    const sameColumn = columnKeyOf(source.statusId) === column.key;
    if (sameColumn && index === from) return; // dropped back where it started

    const before = rest[index - 1] ?? null;
    const after = rest[index] ?? null;
    const rank = rankBetween(before?.rank ?? null, after?.rank ?? null);

    if (sameColumn) updateNode(cardId, { rank }, 'Reorder card');
    else updateNode(cardId, { statusId: column.statusId, rank }, 'Move card');
  };

  const addCardTo = (column: Column): void => {
    if (!doc) return;
    const rank = rankAfterAll((allByColumn.get(column.key) ?? []).map((card) => card.rank));
    const card = makeCard({ statusId: column.statusId, rank, position: nextPosition(doc.nodes) });
    addNode(card);
    openEditor(card.id);
  };

  const overColumn = (column: Column) => (e: DragEvent<HTMLElement>): void => {
    if (dragCardId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ column: column.key, index: (visibleByColumn.get(column.key) ?? []).length });
  };

  const overCard = (column: Column, index: number) => (e: DragEvent<HTMLElement>): void => {
    if (dragCardId === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const box = e.currentTarget.getBoundingClientRect();
    setDropTarget({ column: column.key, index: e.clientY < box.top + box.height / 2 ? index : index + 1 });
  };

  return (
    <div className="flex h-full w-full flex-col bg-canvas text-ink">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <FilterBar />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            <input
              type="checkbox"
              checked={includeNested}
              onChange={(e) => setIncludeNested(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--focus)]"
            />
            Include nested boards
          </label>
          <button
            type="button"
            onClick={() => setStatusEditorOpen(true)}
            className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[13px] text-ink-muted hover:text-ink"
          >
            <SlidersHorizontal size={13} />
            Edit statuses
          </button>
        </div>
      </header>

      {nested.loading || nested.error ? (
        <p
          className="px-4 py-1 text-[13px]"
          style={{ color: nested.error ? 'var(--temper-copper)' : 'var(--ink-muted)' }}
        >
          {nested.error ?? 'Loading the nested boards…'}
        </p>
      ) : null}

      {filterActive && visibleCount === 0 ? (
        <div className="px-4">
          <NoResults />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-3">
          <div className="flex h-full items-stretch gap-3">
            {columns.map((column) => {
              const cards = visibleByColumn.get(column.key) ?? [];
              const borrowed = nestedByColumn.get(column.key) ?? [];
              const empty = cards.length === 0 && borrowed.length === 0;

              return (
                <section
                  key={column.key}
                  onDragOver={overColumn(column)}
                  onDrop={(e) => {
                    if (dragCardId === null) return;
                    e.preventDefault();
                    applyDrop(column);
                  }}
                  className="flex h-full w-[276px] shrink-0 flex-col"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="h-3.5 w-1 shrink-0 rounded-sm"
                      style={{ backgroundColor: column.color ? colorValue(column.color) : 'var(--line-strong)' }}
                      aria-hidden
                    />
                    <h2 className="min-w-0 flex-1 truncate font-condensed text-[15px] font-semibold">
                      {column.name}
                    </h2>
                    <span className="text-[12px] text-ink-muted">{cards.length + borrowed.length}</span>
                    <button
                      type="button"
                      onClick={() => addCardTo(column)}
                      aria-label={`Add a card to ${column.name}`}
                      className="rounded p-0.5 text-ink-muted hover:text-ink"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-8">
                    {empty ? (
                      <div
                        className={`rounded border border-dashed px-3 py-6 text-center text-[13px] text-ink-muted ${
                          dropTarget?.column === column.key ? 'border-[var(--focus)]' : 'border-line'
                        }`}
                      >
                        {column.name}
                      </div>
                    ) : null}

                    {cards.map((card, index) => (
                      <Fragment key={card.id}>
                        <DropLine active={dropTarget?.column === column.key && dropTarget.index === index} />
                        <KanbanCard
                          card={card}
                          labels={doc?.labels ?? []}
                          dragging={dragCardId === card.id}
                          onOpen={() => openEditor(card.id)}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', card.title);
                            setDragCardId(card.id);
                          }}
                          onDragEnd={endDrag}
                          onDragOver={overCard(column, index)}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            applyDrop(column);
                          }}
                        />
                      </Fragment>
                    ))}

                    <DropLine
                      active={dropTarget?.column === column.key && dropTarget.index === cards.length && cards.length > 0}
                    />

                    {borrowed.map((entry) => (
                      <KanbanCard
                        key={`${entry.boardId}:${entry.card.id}`}
                        card={entry.card}
                        labels={doc?.labels ?? []}
                        boardTitle={entry.boardTitle}
                        readOnly
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {statusEditorOpen ? <StatusEditor onClose={() => setStatusEditorOpen(false)} /> : null}
    </div>
  );
}

function DropLine({ active }: { active: boolean }): JSX.Element | null {
  if (!active) return null;
  return <div className="h-0.5 shrink-0 rounded" style={{ backgroundColor: 'var(--focus)' }} aria-hidden />;
}

/** A canvas home for a card created in the column view: below everything else. */
function nextPosition(nodes: { position: { x: number; y: number }; size: { w: number; h: number } }[]): {
  x: number;
  y: number;
} {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let left = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    left = Math.min(left, node.position.x);
    bottom = Math.max(bottom, node.position.y + node.size.h);
  }
  return { x: Math.round(left), y: Math.round(bottom + 32) };
}
