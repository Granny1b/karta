import { useMemo, type DragEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CardNode, ChecklistItem, Id, LabelDef } from '@/domain/board';
import { colorValue } from '@/lib/colors';
import { formatDue } from '@/lib/format';
import { byRank } from '@/lib/ranks';
import { progressOf } from '@/state/selectors';
import { cx } from '@/canvas/cx';
import ProgressRing from '@/card/ProgressRing';

export interface KanbanCardProps {
  card: CardNode;
  labels: LabelDef[];
  /** Set for cards borrowed from a nested board — they render read-only. */
  boardTitle?: string | null;
  readOnly?: boolean;
  dragging?: boolean;
  /** Whether the checklist is showing. Owned by the column, not by the card. */
  expanded?: boolean;
  onOpen?(): void;
  onToggleExpand?(): void;
  onToggleItem?(itemId: Id): void;
  onDragStart?(e: DragEvent<HTMLElement>): void;
  onDragEnd?(e: DragEvent<HTMLElement>): void;
  onDragOver?(e: DragEvent<HTMLElement>): void;
  onDrop?(e: DragEvent<HTMLElement>): void;
}

/**
 * The compact card of the column view: colour bar, title, labels, progress,
 * due date. It is the canvas card's `full` rendering in a column, so it wears
 * the same chips (`.karta-chip`, `.karta-due`) and lifts with the same shadow
 * while it is in the air — one card, two views (spec 7.4).
 *
 * The progress chip opens the checklist in place. Ticking things off is the
 * one job on this board that the panel was making slow: it is a card at a
 * time, and the work is usually a column at a time. Everything else about a
 * checklist — adding, renaming, reordering, deleting — stays in the panel,
 * because none of it is what somebody is doing when they are working through
 * a column (spec 7.4).
 */
export default function KanbanCard({
  card,
  labels,
  boardTitle,
  readOnly = false,
  dragging = false,
  expanded = false,
  onOpen,
  onToggleExpand,
  onToggleItem,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: KanbanCardProps): JSX.Element {
  const progress = progressOf(card);
  const due = formatDue(card.dueDate);
  const cardLabels = card.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter((label): label is LabelDef => label !== undefined);

  const items = useMemo<ChecklistItem[]>(() => [...card.checklist].sort(byRank), [card.checklist]);
  const canExpand = progress.total > 0 && onToggleExpand !== undefined;
  const open = expanded && canExpand;

  return (
    <article
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      /*
       * The card is no longer one big button. It holds two of them now — the
       * title and the progress chip — and a button inside a button is not a
       * thing a screen reader can describe or a keyboard can reach. The title
       * carries the tab stop and the accessible name instead, which is a
       * better name than the `aria-label` this used to need; the click on the
       * card is left as the mouse shortcut it always was.
       */
      onClick={readOnly ? undefined : onOpen}
      className={cx(
        'flex overflow-hidden rounded-md border border-line bg-raised text-left',
        readOnly ? 'opacity-70' : 'cursor-grab',
        dragging && 'opacity-40 shadow-drag',
      )}
    >
      <span className="w-1 shrink-0" style={{ backgroundColor: colorValue(card.color) }} aria-hidden />

      <div className="min-w-0 flex-1 px-2.5 py-2">
        {readOnly || !onOpen ? (
          <p className="karta-card-title">
            {boardTitle ? <span className="font-sans font-normal text-ink-muted">{boardTitle} · </span> : null}
            {card.title.trim().length > 0 ? card.title : 'Untitled card'}
          </p>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="karta-card-title block w-full text-left outline-none focus-visible:underline"
          >
            {card.title.trim().length > 0 ? card.title : 'Untitled card'}
          </button>
        )}

        {cardLabels.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {cardLabels.map((label) => (
              <span key={label.id} className="karta-chip" title={label.name}>
                <span className="karta-chip-dot" style={{ background: colorValue(label.color) }} />
                <span className="max-w-[12ch] truncate">{label.name}</span>
              </span>
            ))}
          </div>
        ) : null}

        {progress.total > 0 || due.tone !== 'none' ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {progress.total > 0 ? (
              canExpand ? (
                <button
                  type="button"
                  aria-expanded={open}
                  /*
                   * The text in this button is "1/3", which is a fine label to
                   * look at and a useless one to hear. The name says what the
                   * numbers mean; `title` stays as the tooltip.
                   */
                  aria-label={`Checklist, ${progress.done} of ${progress.total} done`}
                  title={open ? 'Hide the checklist' : 'Show the checklist'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand();
                  }}
                  className="karta-kanban-progress"
                >
                  <ChevronRight
                    size={12}
                    className={cx('transition-transform duration-fast ease-linear', open && 'rotate-90')}
                    aria-hidden
                  />
                  <ProgressRing done={progress.done} total={progress.total} size={13} />
                  {progress.done}/{progress.total}
                </button>
              ) : (
                <span className="flex items-center gap-1 text-meta tabular-nums text-ink-muted">
                  <ProgressRing done={progress.done} total={progress.total} size={13} />
                  {progress.done}/{progress.total}
                </span>
              )
            ) : null}
            {due.tone !== 'none' ? (
              <span className={cx('karta-due', `karta-due-${due.tone}`)}>{due.text}</span>
            ) : null}
          </div>
        ) : null}

        {open ? (
          // The click that ticks an item must not also open the panel behind it.
          <ul className="karta-kanban-checklist" onClick={(e) => e.stopPropagation()}>
            {items.map((item) => (
              <li key={item.id} className={cx('karta-kanban-item', item.done && 'is-done')}>
                <label className="flex min-w-0 items-start gap-1.5">
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={readOnly || onToggleItem === undefined}
                    onChange={() => onToggleItem?.(item.id)}
                    className="karta-check mt-px"
                  />
                  <span className="min-w-0 flex-1 break-words">{item.text}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
