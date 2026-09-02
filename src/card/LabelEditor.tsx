import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { useUiStore } from '@/state/uiStore';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import IconButton from '@/components/IconButton';
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
 *
 * It is opened by name (`ui.dialog === 'labels'`) from the card editor and
 * from the filter, and drawn by the shell: a dialog mounted inside the panel
 * that asked for it inherits that panel's transform and is clipped to it.
 */
export default function LabelEditor(): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const mutate = useBoardStore((s) => s.mutate);
  const setDialog = useUiStore((s) => s.setDialog);
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

  const close = (): void => setDialog(null);

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
    <Dialog
      title="Labels"
      width="md"
      onClose={close}
      footer={
        <>
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
            className="karta-field min-w-0 flex-1"
          />
          <Button onClick={add} disabled={name.trim().length === 0}>
            <Plus size={14} />
            Add label
          </Button>
        </>
      }
    >
      {labels.length === 0 ? (
        <p className="text-ui text-ink-muted">
          This board has no labels yet. Add one below, or make one straight from a card.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {labels.map((label) => {
            const used = usage.get(label.id) ?? 0;
            const usedText = used === 0 ? 'unused' : `${used} card${used === 1 ? '' : 's'}`;
            return (
              <li key={label.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: `var(--temper-${label.color})` }}
                  />
                  <LabelName label={label} onRename={(value) => rename(label.id, value)} />
                  <span className="shrink-0 text-control text-ink-muted">{usedText}</span>

                  {confirmId === label.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="danger" onClick={() => remove(label.id)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <IconButton
                      size="sm"
                      label={
                        used === 0
                          ? `Delete ${label.name} — nothing is using it`
                          : `Delete ${label.name} — it comes off ${usedText}`
                      }
                      icon={<Trash2 size={14} />}
                      className="karta-icon-btn--danger"
                      onClick={() => setConfirmId(label.id)}
                    />
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
      )}
    </Dialog>
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
      className="karta-field karta-field--sm karta-field--quiet min-w-0 flex-1"
    />
  );
}
