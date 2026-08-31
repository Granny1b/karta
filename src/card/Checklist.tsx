import { useMemo, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import type { ChecklistItem, Id } from '@/domain/board';
import { byRank, rankAfterAll, rankBetween } from '@/lib/ranks';
import { makeChecklistItem } from '@/state/factories';
import ProgressRing from '@/card/ProgressRing';
import { useDraft } from '@/card/useDraft';

export interface ChecklistProps {
  items: ChecklistItem[];
  /** Receives the complete next list plus the undo label for the change. */
  onChange(next: ChecklistItem[], label: string): void;
  disabled?: boolean;
}

const DRAG_TYPE = 'application/x-karta-checklist';

/**
 * The card's checklist: ordered by fractional rank, edited in place, reordered
 * by dragging the handle. Enter in the add field keeps adding, which is how
 * anyone actually types a list of five things.
 */
export default function Checklist({ items, onChange, disabled }: ChecklistProps): JSX.Element {
  const ordered = useMemo(() => [...items].sort(byRank), [items]);
  const done = ordered.reduce((n, item) => (item.done ? n + 1 : n), 0);

  const [text, setText] = useState('');
  const [dragId, setDragId] = useState<Id | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [handleArmed, setHandleArmed] = useState<Id | null>(null);
  const addRef = useRef<HTMLInputElement | null>(null);

  const add = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const item = makeChecklistItem({ text: trimmed, rank: rankAfterAll(items.map((i) => i.rank)) });
    onChange([...items, item], 'Add checklist item');
    setText('');
    addRef.current?.focus();
  };

  const patch = (id: Id, change: Partial<ChecklistItem>, label: string): void => {
    onChange(
      items.map((item) => (item.id === id ? { ...item, ...change } : item)),
      label,
    );
  };

  const remove = (id: Id): void => {
    onChange(
      items.filter((item) => item.id !== id),
      'Delete checklist item',
    );
  };

  const endDrag = (): void => {
    setDragId(null);
    setDropIndex(null);
    setHandleArmed(null);
  };

  const drop = (): void => {
    if (dragId === null || dropIndex === null) {
      endDrag();
      return;
    }
    const from = ordered.findIndex((item) => item.id === dragId);
    const rest = ordered.filter((item) => item.id !== dragId);
    const target = from >= 0 && from < dropIndex ? dropIndex - 1 : dropIndex;
    endDrag();
    if (target === from) return; // dropped back where it started

    const before = rest[target - 1] ?? null;
    const after = rest[target] ?? null;
    patch(dragId, { rank: rankBetween(before?.rank ?? null, after?.rank ?? null) }, 'Reorder checklist');
  };

  return (
    <div className="flex flex-col gap-1.5">
      {ordered.length > 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-muted">
          <ProgressRing done={done} total={ordered.length} size={14} />
          <span>
            {done} of {ordered.length}
          </span>
        </div>
      ) : null}

      <ul
        className="flex flex-col"
        onDragOver={(e) => {
          if (dragId === null) return;
          e.preventDefault();
          setDropIndex(ordered.length);
        }}
        onDrop={(e) => {
          if (dragId === null) return;
          e.preventDefault();
          drop();
        }}
      >
        {ordered.map((item, index) => (
          <li
            key={item.id}
            draggable={!disabled && handleArmed === item.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData(DRAG_TYPE, item.id);
              setDragId(item.id);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              e.stopPropagation();
              const box = e.currentTarget.getBoundingClientRect();
              setDropIndex(e.clientY < box.top + box.height / 2 ? index : index + 1);
            }}
            onDrop={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              e.stopPropagation();
              drop();
            }}
            className={`group flex items-center gap-1.5 border-y border-transparent py-0.5 ${
              dropIndex === index ? 'border-t-[var(--focus)]' : ''
            } ${dropIndex === index + 1 ? 'border-b-[var(--focus)]' : ''} ${
              dragId === item.id ? 'opacity-40' : ''
            }`}
          >
            <button
              type="button"
              disabled={disabled}
              aria-label="Reorder"
              onMouseDown={() => setHandleArmed(item.id)}
              onMouseUp={() => setHandleArmed(null)}
              className="cursor-grab text-ink-muted opacity-0 group-hover:opacity-100 disabled:hidden"
            >
              <GripVertical size={14} />
            </button>

            <input
              type="checkbox"
              disabled={disabled}
              checked={item.done}
              onChange={() => patch(item.id, { done: !item.done }, item.done ? 'Uncheck item' : 'Check item')}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--focus)]"
            />

            <ItemText
              item={item}
              disabled={disabled}
              onRename={(value) => patch(item.id, { text: value }, 'Edit checklist item')}
            />

            <button
              type="button"
              disabled={disabled}
              aria-label="Delete item"
              onClick={() => remove(item.id)}
              className="text-ink-muted opacity-0 hover:text-ink group-hover:opacity-100 disabled:hidden"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>

      <input
        ref={addRef}
        value={text}
        disabled={disabled}
        placeholder="Add an item"
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
          if (e.key === 'Escape' && text.length > 0) {
            e.stopPropagation();
            setText('');
          }
        }}
        className="rounded border border-line bg-raised px-2 py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted focus:border-[var(--focus)] disabled:opacity-50"
      />
    </div>
  );
}

function ItemText({
  item,
  disabled,
  onRename,
}: {
  item: ChecklistItem;
  disabled?: boolean;
  onRename(value: string): void;
}): JSX.Element {
  const draft = useDraft(item.text, onRename);

  return (
    <input
      value={draft.value}
      disabled={disabled}
      onChange={(e) => draft.setValue(e.target.value)}
      onBlur={draft.flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          draft.flush();
          e.currentTarget.blur();
        }
      }}
      className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[14px] outline-none focus:border-line ${
        item.done ? 'text-ink-muted line-through' : 'text-ink'
      }`}
    />
  );
}
