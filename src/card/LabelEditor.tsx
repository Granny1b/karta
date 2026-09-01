import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  capText,
  isCardNode,
  MAX_NAME,
  type ColorToken,
  type Id,
  type LabelDef,
} from '@/domain/board';
import { isColorToken } from '@/lib/colors';
import { makeLabel } from '@/state/factories';
import { useBoardStore } from '@/state/boardStore';
import ColorSwatches from '@/card/ColorSwatches';
import { useDraft } from '@/card/useDraft';

/**
 * The board's labels: rename, recolour, add, delete.
 *
 * The label picker on a card could only ever create one, so a typo or a label
 * that stopped being useful was permanent — the board accumulated them and
 * offered no way back. This is the same shape as the status editor next door,
 * deliberately: two lists of named, coloured, board-level things should not be
 * managed two different ways.
 *
 * Deleting a label takes it off every card that carries it, in the same write,
 * so no card is left pointing at a label that is gone. That is the one thing
 * this dialog does that cannot be undone by retyping the name, so it asks
 * first and says how many cards it is about to touch.
 */
export default function LabelEditor({ onClose }: { onClose(): void }): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const mutate = useBoardStore((s) => s.mutate);
  const [name, setName] = useState('');
  const [confirmId, setConfirmId] = useState<Id | null>(null);

  const labels = useMemo(() => doc?.labels ?? [], [doc?.labels]);

  /** How many cards wear each label, which is what makes a delete a decision. */
  const usage = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const node of doc?.nodes ?? []) {
      if (!isCardNode(node)) continue;
      for (const id of node.labelIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [doc?.nodes]);

  const rename = (id: Id, value: string): void => {
    mutate('Rename label', (d) => {
      const label = d.labels.find((l) => l.id === id);
      if (label) label.name = value;
    });
  };

  const recolour = (id: Id, color: ColorToken): void => {
    mutate('Recolour label', (d) => {
      const label = d.labels.find((l) => l.id === id);
      if (label) label.color = color;
    });
  };

  const add = (): void => {
    const trimmed = capText(name.trim(), MAX_NAME);
    if (trimmed.length === 0) return;
    // Two labels with one name is a board that cannot be filtered sensibly.
    if (labels.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
      setName('');
      return;
    }
    mutate('Add label', (d) => {
      d.labels.push(makeLabel({ name: trimmed, color: 'slate' }));
    });
    setName('');
  };

  const remove = (id: Id): void => {
    setConfirmId(null);
    mutate('Delete label', (d) => {
      d.labels = d.labels.filter((l) => l.id !== id);
      // The card keeps everything else; only the reference to a label that no
      // longer exists goes, and it goes in the same write as the label itself.
      for (const node of d.nodes) {
        if (!isCardNode(node)) continue;
        if (node.labelIds.includes(id)) node.labelIds = node.labelIds.filter((l) => l !== id);
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Board labels"
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
          <h2 className="font-condensed text-[17px] font-semibold">Labels</h2>
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
          {labels.length === 0 ? (
            <p className="mb-3 text-[14px] text-ink-muted">
              This board has no labels yet. Add one below, or make one straight from a card.
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {labels.map((label) => {
              const used = usage.get(label.id) ?? 0;
              return (
                <li key={label.id} className="rounded border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: `var(--temper-${label.color})` }}
                    />
                    <LabelName label={label} onRename={(value) => rename(label.id, value)} />
                    <span className="shrink-0 text-[12px] text-ink-muted">
                      {used === 0 ? 'unused' : `${used} card${used === 1 ? '' : 's'}`}
                    </span>

                    {confirmId === label.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => remove(label.id)}
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
                        onClick={() => setConfirmId(label.id)}
                        aria-label={`Delete ${label.name}`}
                        title={
                          used === 0
                            ? 'Nothing is using it'
                            : `It comes off ${used} card${used === 1 ? '' : 's'}`
                        }
                        className="shrink-0 rounded p-1 text-ink-muted hover:text-[var(--temper-copper)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <div className="mt-2 pl-5">
                    <ColorSwatches
                      tokensOnly
                      value={label.color}
                      onChange={(next) => {
                        if (isColorToken(next)) recolour(label.id, next);
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <input
            value={name}
            maxLength={MAX_NAME}
            placeholder="New label name"
            aria-label="New label name"
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
            Add label
          </button>
        </footer>
      </div>
    </div>
  );
}

function LabelName({ label, onRename }: { label: LabelDef; onRename(value: string): void }): JSX.Element {
  const draft = useDraft(label.name, (value) => onRename(capText(value, MAX_NAME)));
  return (
    <input
      value={draft.value}
      maxLength={MAX_NAME}
      aria-label="Label name"
      onChange={(e) => draft.setValue(e.target.value)}
      onBlur={draft.flush}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[14px] text-ink outline-none focus:border-line"
    />
  );
}
