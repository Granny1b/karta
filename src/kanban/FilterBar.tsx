import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { Id } from '@/domain/board';
import { colorValue } from '@/lib/colors';
import LabelEditor from '@/card/LabelEditor';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';

/**
 * Text, labels, status, has-a-due-date and has-an-unfinished-checklist
 * (spec 7.4). The state lives in the ui store, so the kanban hides non-matching
 * cards while the canvas dims them — one filter, two readings.
 */
export default function FilterBar(): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const clearFilter = useUiStore((s) => s.clearFilter);
  const active = useUiStore((s) => s.filterActive());
  const [labelEditorOpen, setLabelEditorOpen] = useState(false);

  const labels = doc?.labels ?? [];
  const statuses = doc ? [...doc.statuses].sort((a, b) => a.order - b.order) : [];

  const toggle = (list: Id[], id: Id): Id[] =>
    list.includes(id) ? list.filter((value) => value !== id) : [...list, id];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          value={filter.text}
          placeholder="Filter cards"
          aria-label="Filter cards by text"
          onChange={(e) => setFilter({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filter.text.length > 0) {
              e.stopPropagation();
              setFilter({ text: '' });
            }
          }}
          className="w-44 rounded border border-line bg-raised py-1 pl-7 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-[var(--focus)]"
        />
      </div>

      <Dropdown label="Labels" count={filter.labelIds.length} disabled={labels.length === 0}>
        {/* Where labels are used is also where a stale one is noticed. */}
        <button
          type="button"
          onClick={() => setLabelEditorOpen(true)}
          className="mb-1 w-full border-b border-line px-2 pb-1.5 pt-1 text-left text-[12px] text-ink-muted hover:text-ink"
        >
          Manage labels
        </button>
        {labels.map((label) => (
          <Option
            key={label.id}
            checked={filter.labelIds.includes(label.id)}
            onClick={() => setFilter({ labelIds: toggle(filter.labelIds, label.id) })}
            swatch={colorValue(label.color)}
          >
            {label.name}
          </Option>
        ))}
      </Dropdown>

      <Dropdown label="Status" count={filter.statusIds.length} disabled={statuses.length === 0}>
        {statuses.map((status) => (
          <Option
            key={status.id}
            checked={filter.statusIds.includes(status.id)}
            onClick={() => setFilter({ statusIds: toggle(filter.statusIds, status.id) })}
            swatch={colorValue(status.color)}
          >
            {status.name}
          </Option>
        ))}
      </Dropdown>

      <Chip active={filter.hasDue} onClick={() => setFilter({ hasDue: !filter.hasDue })}>
        Has a due date
      </Chip>
      <Chip
        active={filter.hasOpenChecklist}
        onClick={() => setFilter({ hasOpenChecklist: !filter.hasOpenChecklist })}
      >
        Unfinished checklist
      </Chip>

      {active ? (
        <button
          type="button"
          onClick={clearFilter}
          className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[13px] text-ink-muted hover:text-ink"
        >
          <X size={13} />
          Clear the filter
        </button>
      ) : null}

      {labelEditorOpen ? <LabelEditor onClose={() => setLabelEditorOpen(false)} /> : null}
    </div>
  );
}

/** Spec 8.4: "Nothing matches. Clear the filter." */
export function NoResults(): JSX.Element {
  const clearFilter = useUiStore((s) => s.clearFilter);
  return (
    <p className="px-1 py-6 text-[15px] text-ink-muted">
      Nothing matches.{' '}
      <button type="button" onClick={clearFilter} className="underline underline-offset-2 hover:no-underline">
        Clear the filter.
      </button>
    </p>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-[13px] ${
        active ? 'border-line-strong text-ink' : 'border-line text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Dropdown({
  label,
  count,
  disabled,
  children,
}: {
  label: string;
  count: number;
  disabled?: boolean;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1 rounded border px-2 py-1 text-[13px] disabled:opacity-50 ${
          count > 0 ? 'border-line-strong text-ink' : 'border-line text-ink-muted hover:text-ink'
        }`}
      >
        {label}
        {count > 0 ? ` (${count})` : ''}
        <ChevronDown size={13} />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-64 w-52 overflow-y-auto rounded border border-line bg-raised py-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Option({
  checked,
  swatch,
  onClick,
  children,
}: {
  checked: boolean;
  swatch: string;
  onClick(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className="flex w-full items-center gap-2 px-2 py-1 text-left text-[13px] text-ink hover:bg-sunken"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: swatch }} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked ? <Check size={13} className="shrink-0" /> : null}
    </button>
  );
}
