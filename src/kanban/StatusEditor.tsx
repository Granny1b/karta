import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import {
  capText,
  isCardNode,
  MAX_NAME,
  type ColorToken,
  type Id,
  type StatusDef,
} from '@/domain/board';
import { isColorToken } from '@/lib/colors';
import { rankBetween } from '@/lib/ranks';
import { makeStatus } from '@/state/factories';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import IconButton from '@/components/IconButton';
import ColorSwatches from '@/card/ColorSwatches';
import { useDraft } from '@/card/useDraft';

/**
 * The board's columns: rename, reorder, recolour, mark as done, add, delete.
 * Deleting a status leaves its cards on the board and moves them to "No status"
 * with fresh ranks, so nothing is ever lost behind a column that is gone.
 *
 * Opened by name (`ui.dialog === 'statuses'`) and drawn by the shell, like the
 * label editor it is the twin of.
 */
export default function StatusEditor(): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const mutate = useBoardStore((s) => s.mutate);
  const setDialog = useUiStore((s) => s.setDialog);
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

  const close = (): void => setDialog(null);

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
    const trimmed = capText(name.trim(), MAX_NAME);
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
    <Dialog
      title="Statuses"
      width="md"
      onClose={close}
      footer={
        <>
          <input
            value={name}
            maxLength={MAX_NAME}
            placeholder="New status name"
            aria-label="New status name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            className="karta-field min-w-0 flex-1"
          />
          <Button onClick={add} disabled={name.trim().length === 0}>
            <Plus size={14} />
            Add status
          </Button>
        </>
      }
    >
      {statuses.length === 0 ? (
        <p className="text-ui text-ink-muted">
          This board has no statuses. Every card sits in "No status" until you add one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {statuses.map((status, index) => {
            const cards = cardCount.get(status.id) ?? 0;
            return (
              <li key={status.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex shrink-0 items-center">
                    <IconButton
                      size="sm"
                      label={`Move ${status.name} up`}
                      icon={<ChevronUp size={14} />}
                      disabled={index === 0}
                      onClick={() => move(status.id, -1)}
                    />
                    <IconButton
                      size="sm"
                      label={`Move ${status.name} down`}
                      icon={<ChevronDown size={14} />}
                      disabled={index === statuses.length - 1}
                      onClick={() => move(status.id, 1)}
                    />
                  </div>

                  <StatusName status={status} onRename={(value) => rename(status.id, value)} />

                  <span className="shrink-0 text-control text-ink-muted">
                    {cards} card{cards === 1 ? '' : 's'}
                  </span>

                  {confirmId === status.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="danger" onClick={() => remove(status.id)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <IconButton
                      size="sm"
                      label={`Delete ${status.name} — its cards move to No status`}
                      icon={<Trash2 size={14} />}
                      className="karta-icon-btn--danger"
                      onClick={() => setConfirmId(status.id)}
                    />
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-2">
                  <ColorSwatches
                    tokensOnly
                    value={status.color}
                    onChange={(next) => {
                      if (isColorToken(next)) recolour(status.id, next);
                    }}
                  />
                  <label className="flex items-center gap-2 text-caption text-ink-muted">
                    <input
                      type="checkbox"
                      checked={status.isDone}
                      onChange={() => toggleDone(status.id)}
                      className="karta-check"
                    />
                    Counts as done
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

function StatusName({ status, onRename }: { status: StatusDef; onRename(value: string): void }): JSX.Element {
  const draft = useDraft(status.name, (value) => onRename(capText(value, MAX_NAME)));
  return (
    <input
      value={draft.value}
      maxLength={MAX_NAME}
      aria-label="Status name"
      onChange={(e) => draft.setValue(e.target.value)}
      onBlur={draft.flush}
      className="karta-field karta-field--sm karta-field--quiet min-w-0 flex-1"
    />
  );
}
