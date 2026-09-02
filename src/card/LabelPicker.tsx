import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { MAX_NAME, type ColorToken, type Id, type LabelDef } from '@/domain/board';
import { colorValue, isColorToken } from '@/lib/colors';
import Button from '@/components/Button';
import ColorSwatches from '@/card/ColorSwatches';

export interface LabelPickerProps {
  labels: LabelDef[];
  selectedIds: Id[];
  onToggle(labelId: Id): void;
  onCreate(name: string, color: ColorToken): void;
  disabled?: boolean;
}

/** Pick from the board's labels, or make one on the spot (spec 7.2 card/). */
export default function LabelPicker({
  labels,
  selectedIds,
  onToggle,
  onCreate,
  disabled,
}: LabelPickerProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColorToken>('slate');

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onCreate(trimmed, color);
    setName('');
    setColor('slate');
    setCreating(false);
  };

  const cancel = (): void => {
    setCreating(false);
    setName('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Labels">
        {labels.map((label) => {
          const active = selectedIds.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={active ? 'Remove from this card' : 'Put on this card'}
              onClick={() => onToggle(label.id)}
              className="karta-toggle group max-w-full"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-xs"
                style={{ backgroundColor: colorValue(label.color) }}
                aria-hidden
              />
              <span className="min-w-0 truncate">{label.name}</span>
              {/* Worn: a tick at rest, and a cross under the pointer, so the
                  chip says what the next click does before it is made. */}
              {active ? (
                <span className="shrink-0" aria-hidden>
                  <Check size={12} strokeWidth={3} className="group-hover:hidden" />
                  <X size={12} strokeWidth={3} className="hidden group-hover:block" />
                </span>
              ) : null}
            </button>
          );
        })}

        {creating || disabled ? null : (
          <button type="button" onClick={() => setCreating(true)} className="karta-toggle karta-toggle--dashed">
            <Plus size={12} />
            New label
          </button>
        )}
      </div>

      {creating ? (
        <div className="flex flex-col gap-2 rounded-md border border-line p-2">
          <input
            autoFocus
            value={name}
            maxLength={MAX_NAME}
            placeholder="Label name"
            aria-label="Label name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                cancel();
              }
            }}
            className="karta-field"
          />
          <ColorSwatches
            tokensOnly
            value={color}
            onChange={(next) => setColor(isColorToken(next) ? next : 'slate')}
          />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="primary" onClick={submit} disabled={name.trim().length === 0}>
              Add label
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
