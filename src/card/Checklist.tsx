import { useMemo, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { MAX_CHECKLIST_TEXT, capText, type ChecklistItem, type Id } from '@/domain/board';
import { byRank, rankAfterAll, rankBetween } from '@/lib/ranks';
import { makeChecklistItem } from '@/state/factories';
import { cx } from '@/canvas/cx';
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
 *
 * An item's words wrap. They used to sit in a one-line field, so anything
 * longer than the panel was cut off at the edge and could only be read by
 * clicking in and walking the caret along it — a checklist that has to be
 * scrolled through a slot is not a list that can be read.
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
    const trimmed = capText(text.trim(), MAX_CHECKLIST_TEXT);
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

  /** Where the drop line is drawn: above the row it lands before, or below the last. */
  const dropSide = (index: number): 'before' | 'after' | undefined => {
    if (dropIndex === null) return undefined;
    if (dropIndex === index) return 'before';
    if (dropIndex === ordered.length && index === ordered.length - 1) return 'after';
    return undefined;
  };

  return (
    <div className="flex flex-col gap-2">
      {ordered.length > 0 ? (
        <p className="karta-caption flex items-center gap-2">
          <ProgressRing done={done} total={ordered.length} size={14} />
          <span>
            {done} of {ordered.length}
          </span>
        </p>
      ) : null}

      <ul
        className="karta-checklist"
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
            data-drop={dropSide(index)}
            className={cx('karta-checklist-row', dragId === item.id && 'is-dragging', item.done && 'is-done')}
          >
            <button
              type="button"
              disabled={disabled}
              aria-label="Reorder"
              title="Drag to reorder"
              onMouseDown={() => setHandleArmed(item.id)}
              onMouseUp={() => setHandleArmed(null)}
              className="karta-checklist-aside karta-checklist-tool karta-checklist-tool--grip"
            >
              <GripVertical size={14} />
            </button>

            <span className="karta-checklist-aside">
              <input
                type="checkbox"
                disabled={disabled}
                checked={item.done}
                aria-label={item.done ? 'Done' : 'Not done'}
                onChange={() => patch(item.id, { done: !item.done }, item.done ? 'Uncheck item' : 'Check item')}
                className="karta-check"
              />
            </span>

            <ItemText
              item={item}
              disabled={disabled}
              onRename={(value) => patch(item.id, { text: capText(value, MAX_CHECKLIST_TEXT) }, 'Edit checklist item')}
            />

            <button
              type="button"
              disabled={disabled}
              aria-label="Delete item"
              title="Delete item"
              onClick={() => remove(item.id)}
              className="karta-checklist-aside karta-checklist-tool"
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
        maxLength={MAX_CHECKLIST_TEXT}
        placeholder="Add an item"
        aria-label="Add a checklist item"
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
        className="karta-field"
      />
    </div>
  );
}

/**
 * One item's words: a field exactly as tall as what it holds (`.karta-grow`),
 * so a long item is read across three lines rather than scrolled through one.
 * Enter finishes the edit, as it does everywhere else in the panel.
 */
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
    <div className="karta-grow karta-checklist-text" data-value={draft.value}>
      <textarea
        rows={1}
        value={draft.value}
        disabled={disabled}
        maxLength={MAX_CHECKLIST_TEXT}
        aria-label="Checklist item"
        onChange={(e) => draft.setValue(e.target.value)}
        onBlur={draft.flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            draft.flush();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
