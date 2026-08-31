import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react';
import { isCardNode, type ColorToken, type Id, type StatusDef } from '@/domain/board';
import { isColorToken } from '@/lib/colors';
import { rankBetween } from '@/lib/ranks';
import { makeStatus } from '@/state/factories';
import { useBoardStore } from '@/state/boardStore';
import ColorSwatches from '@/card/ColorSwatches';
import { useDraft } from '@/card/useDraft';

/**
 * The board's columns: rename, reorder, recolour, mark as done, add, delete.
 * Deleting a status leaves its cards on the board and moves them to "No status"
 * with fresh ranks, so nothing is ever lost behind a column that is gone.
 */
export default function StatusEditor({ onClose }: { onClose(): void }): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const mutate = useBoardStore((s) => s.mutate);
  const [name, setName] = useState('');
  const [confirmId, setConfirmId] = useState<Id | null>(null);

  const statuses = useMemo(() => [...(doc?.statuses ?? [])].sort((a, b) => a.order - b.order), [doc?.statuses]);

  const cardCount = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const node of doc?.nodes ?? []) {
      if (!isCardNode(node) || node.statusId === null) continue;
      counts.set(node.statusId, (counts.get(node.statusId) ?? 0) + 1);
    }
    return counts;
  }, [doc?.nodes]);

  const rename = (id: Id, value: string): void => {
    mutate('Rename status', (d) => {
      const status = d.statuses.find((s) => s.id === id);
      if (status) status.name = value;
    });
  };

  const recolour = (id: Id, color: ColorToken): void => {
    mutate('Recolour status', (d) => {
      const status = d.statuses.find((s) => s.id === id);
      if (status) status.color = color;
    });
  };

  const toggleDone = (id: Id): void => {
    mutate('Change done flag', (d) => {
      const status = d.statuses.find((s) => s.id === id);
      if (status) status.isDone = !status.isDone;
    });
  };

  const move = (id: Id, delta: -1 | 1): void => {
    mutate('Reorder statuses', (d) => {
      const ordered = [...d.statuses].sort((a, b) => a.order - b.order);
      const from = ordered.findIndex((s) => s.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ordered.length) return;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      ordered.forEach((status, index) => {
        status.order = index;
      });
    });
  };

  const add = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    mutate('Add status', (d) => {
      const order = d.statuses.reduce((max, s) => Math.max(max, s.order + 1), 0);
      d.statuses.push(makeStatus({ name: trimmed, order }));
    });
    setName('');
  };

  const remove = (id: Id): void => {
    setConfirmId(null);
    mutate('Delete status', (d) => {
      d.statuses = d.statuses.filter((s) => s.id !== id);
      d.statuses.sort((a, b) => a.order - b.order).forEach((status, index) => {
        status.order = index;
      });

      // The orphaned cards join the end of the "No status" column.
      let rank = rankBetween(
        d.nodes.reduce<string | null>((max, node) => {
          if (!isCardNode(node) || node.statusId !== null) return max;
          return max === null || node.rank > max ? node.rank : max;
        }, null),
        null,
      );
      for (const node of d.nodes) {
        if (!isCardNode(node) || node.statusId !== id) continue;
        node.statusId = null;
        node.rank = rank;
        rank = rankBetween(rank, null);
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Board statuses"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded border border-line bg-raised text-ink">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-condensed text-[17px] font-semibold">Statuses</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-muted hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {statuses.length === 0 ? (
            <p className="mb-3 text-[14px] text-ink-muted">
              This board has no statuses. Every card sits in "No status" until you add one.
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {statuses.map((status, index) => (
              <li key={status.id} className="rounded border border-line px-2 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(status.id, -1)}
                      aria-label={`Move ${status.name} up`}
                      className="text-ink-muted hover:text-ink disabled:opacity-30"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === statuses.length - 1}
                      onClick={() => move(status.id, 1)}
                      aria-label={`Move ${status.name} down`}
                      className="text-ink-muted hover:text-ink disabled:opacity-30"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>

                  <StatusName status={status} onRename={(value) => rename(status.id, value)} />

                  <span className="shrink-0 text-[12px] text-ink-muted">
                    {cardCount.get(status.id) ?? 0} cards
                  </span>

                  {confirmId === status.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => remove(status.id)}
                        className="rounded border border-line px-2 py-1 text-[12px] text-[var(--temper-copper)] hover:bg-sunken"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="px-1 text-[12px] text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(status.id)}
                      aria-label={`Delete ${status.name}`}
                      title="Its cards move to No status"
                      className="shrink-0 rounded p-1 text-ink-muted hover:text-[var(--temper-copper)]"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 pl-6">
                  <ColorSwatches
                    tokensOnly
                    value={status.color}
                    onChange={(next) => {
                      if (isColorToken(next)) recolour(status.id, next);
                    }}
                  />
                  <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
                    <input
                      type="checkbox"
                      checked={status.isDone}
                      onChange={() => toggleDone(status.id)}
                      className="h-3.5 w-3.5 accent-[var(--focus)]"
                    />
                    Counts as done
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <input
            value={name}
            placeholder="New status name"
            aria-label="New status name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            className="min-w-0 flex-1 rounded border border-line bg-raised px-2 py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted focus:border-[var(--focus)]"
          />
          <button
            type="button"
            onClick={add}
            disabled={name.trim().length === 0}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[13px] text-ink hover:bg-sunken disabled:opacity-50"
          >
            <Plus size={13} />
            Add status
          </button>
        </footer>
      </div>
    </div>
  );
}

function StatusName({ status, onRename }: { status: StatusDef; onRename(value: string): void }): JSX.Element {
  const draft = useDraft(status.name, onRename);
  return (
    <input
      value={draft.value}
      aria-label="Status name"
      onChange={(e) => draft.setValue(e.target.value)}
      onBlur={draft.flush}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[14px] text-ink outline-none focus:border-line"
    />
  );
}
