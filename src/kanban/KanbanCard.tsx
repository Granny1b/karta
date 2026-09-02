import type { DragEvent } from 'react';
import type { CardNode, LabelDef } from '@/domain/board';
import { colorValue } from '@/lib/colors';
import { formatDue } from '@/lib/format';
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
  onOpen?(): void;
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
 */
export default function KanbanCard({
  card,
  labels,
  boardTitle,
  readOnly = false,
  dragging = false,
  onOpen,
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

  return (
    <article
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={readOnly ? undefined : onOpen}
      onKeyDown={(e) => {
        if (readOnly || !onOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      aria-label={card.title}
      className={cx(
        'flex overflow-hidden rounded-md border border-line bg-raised text-left outline-none focus-visible:border-focus',
        readOnly ? 'opacity-70' : 'cursor-grab',
        dragging && 'opacity-40 shadow-drag',
      )}
    >
      <span className="w-1 shrink-0" style={{ backgroundColor: colorValue(card.color) }} aria-hidden />

      <div className="min-w-0 flex-1 px-2.5 py-2">
        <p className="karta-card-title">
          {boardTitle ? <span className="font-sans font-normal text-ink-muted">{boardTitle} · </span> : null}
          {card.title.trim().length > 0 ? card.title : 'Untitled card'}
        </p>

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
              <span className="flex items-center gap-1 text-meta tabular-nums text-ink-muted">
                <ProgressRing done={progress.done} total={progress.total} size={13} />
                {progress.done}/{progress.total}
              </span>
            ) : null}
            {due.tone !== 'none' ? (
              <span className={cx('karta-due', `karta-due-${due.tone}`)}>{due.text}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
