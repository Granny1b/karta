import type { DragEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import type { CardNode, LabelDef } from '@/domain/board';
import { colorValue } from '@/lib/colors';
import { formatDue, type DueTone } from '@/lib/format';
import { progressOf } from '@/state/selectors';
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

const DUE_COLOR: Record<DueTone, string> = {
  none: 'var(--ink-muted)',
  overdue: 'var(--temper-copper)',
  today: 'var(--temper-bronze)',
  soon: 'var(--temper-straw)',
  later: 'var(--ink-muted)',
};

/** The compact card of the column view: colour bar, title, labels, progress, due date. */
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
      className={`flex overflow-hidden rounded border border-line bg-raised text-left outline-none focus-visible:border-[var(--focus)] ${
        readOnly ? 'opacity-70' : 'cursor-grab'
      } ${dragging ? 'opacity-40 shadow-lg' : ''}`}
    >
      <span className="w-1 shrink-0" style={{ backgroundColor: colorValue(card.color) }} aria-hidden />

      <div className="min-w-0 flex-1 px-2.5 py-2">
        <p className="font-condensed text-[15px] font-semibold leading-snug text-ink">
          {boardTitle ? <span className="font-sans font-normal text-ink-muted">{boardTitle} · </span> : null}
          {card.title.trim().length > 0 ? card.title : 'Untitled card'}
        </p>

        {cardLabels.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {cardLabels.map((label) => (
              <span
                key={label.id}
                className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: colorValue(label.color) }}
                />
                {label.name}
              </span>
            ))}
          </div>
        ) : null}

        {progress.total > 0 || due.tone !== 'none' ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
            {progress.total > 0 ? (
              <span className="flex items-center gap-1.5">
                <ProgressRing done={progress.done} total={progress.total} size={13} />
                {progress.done} of {progress.total}
              </span>
            ) : null}
            {due.tone !== 'none' ? (
              <span className="flex items-center gap-1" style={{ color: DUE_COLOR[due.tone] }}>
                <CalendarDays size={12} />
                {due.text}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
