import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { ColorToken, Id, LabelDef } from '@/domain/board';
import { colorValue, isColorToken } from '@/lib/colors';
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((label) => {
          const active = selectedIds.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onToggle(label.id)}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[13px] disabled:opacity-50 ${
                active ? 'border-line-strong text-ink' : 'border-line text-ink-muted hover:text-ink'
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: colorValue(label.color) }}
              />
              {label.name}
              {active ? <Check size={12} strokeWidth={3} /> : null}
            </button>
          );
        })}

        {creating || disabled ? null : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 rounded border border-dashed border-line px-2 py-1 text-[13px] text-ink-muted hover:text-ink"
          >
            <Plus size={12} />
            New label
          </button>
        )}
      </div>

      {creating ? (
        <div className="flex flex-col gap-2 rounded border border-line p-2">
          <input
            autoFocus
            value={name}
            placeholder="Label name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setCreating(false);
                setName('');
              }
            }}
            className="w-full rounded border border-line bg-raised px-2 py-1 text-[14px] text-ink outline-none focus:border-[var(--focus)]"
          />
          <ColorSwatches
            tokensOnly
            value={color}
            onChange={(next) => setColor(isColorToken(next) ? next : 'slate')}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={name.trim().length === 0}
              className="rounded border border-line px-2 py-1 text-[13px] text-ink hover:bg-sunken disabled:opacity-50"
            >
              Add label
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName('');
              }}
              className="px-1 py-1 text-[13px] text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
