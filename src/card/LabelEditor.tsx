import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { capText, MAX_NAME, type ColorToken, type Id, type LabelDef } from '@/domain/board';
import { isColorToken } from '@/lib/colors';
import { makeLabel } from '@/state/factories';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import IconButton from '@/components/IconButton';
import ColorSwatches from '@/card/ColorSwatches';
import { deleteLabels, labelUsage, unusedLabels } from '@/card/labels';
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
 * Deleting is as cheap as the delete is: a label no card wears goes on one
 * click, and all of them go on two. A label cards do wear comes off every one
 * of them in the same write, so no card is left pointing at a label that is
 * gone — that is the one thing here that a retyped name cannot undo, so it
 * asks first and says how many cards it is about to touch.
 *
 * It is opened by name (`ui.dialog === 'labels'`) from the card editor, the
 * filter and the column view, and drawn by the shell: a dialog mounted inside
 * the panel that asked for it inherits that panel's transform and is clipped
 * to it.
 */
export default function LabelEditor(): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const mutate = useBoardStore((s) => s.mutate);
  const setDialog = useUiStore((s) => s.setDialog);
  const toast = useUiStore((s) => s.toast);
  const [name, setName] = useState('');
  const [confirmId, setConfirmId] = useState<Id | null>(null);
  const [confirmUnused, setConfirmUnused] = useState(false);

  const labels = useMemo(() => doc?.labels ?? [], [doc?.labels]);
  const usage = useMemo(() => labelUsage(doc?.nodes ?? []), [doc?.nodes]);
  const unused = useMemo(() => unusedLabels(labels, usage), [labels, usage]);

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
      deleteLabels(d, new Set([id]));
    });
  };

  const removeUnused = (): void => {
    setConfirmUnused(false);
    const ids = new Set(unused.map((label) => label.id));
    if (ids.size === 0) return;
    mutate('Delete unused labels', (d) => {
      deleteLabels(d, ids);
    });
    toast(`Deleted ${ids.size} unused label${ids.size === 1 ? '' : 's'}. Ctrl+Z brings them back.`);
  };

  /** "3 cards", or the fact that there are none — the whole cost of a delete. */
  const wornBy = (count: number): string =>
    count === 0 ? 'unused' : `${count} card${count === 1 ? '' : 's'}`;

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
        <>
          <div className="karta-fieldset-head mb-3">
            <p className="karta-caption">
              {labels.length} label{labels.length === 1 ? '' : 's'}
              {unused.length > 0 ? ` · ${unused.length} unused` : ''}
            </p>
            {unused.length === 0 ? null : confirmUnused ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="danger" onClick={removeUnused}>
                  Delete {unused.length} unused
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmUnused(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => setConfirmUnused(true)}>
                <Trash2 size={13} />
                Delete unused
              </Button>
            )}
          </div>

          <ul className="flex flex-col gap-2">
            {labels.map((label) => {
              const used = usage.get(label.id) ?? 0;
              return (
                <li key={label.id} className="rounded-md border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: `var(--temper-${label.color})` }}
                    />
                    <LabelName label={label} onRename={(value) => rename(label.id, value)} />
                    {/* The confirmation says the count itself, so it is not said twice. */}
                    {confirmId === label.id ? null : (
                      <span className="shrink-0 text-control text-ink-muted">{wornBy(used)}</span>
                    )}

                    {confirmId === label.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="sm" variant="danger" onClick={() => remove(label.id)}>
                          Take it off {wornBy(used)}
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
                            : `Delete ${label.name} — it comes off ${wornBy(used)}`
                        }
                        icon={<Trash2 size={14} />}
                        className="karta-icon-btn--danger"
                        // Nothing to lose, nothing to ask: an unused label goes on one click.
                        onClick={() => (used === 0 ? remove(label.id) : setConfirmId(label.id))}
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
        </>
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
