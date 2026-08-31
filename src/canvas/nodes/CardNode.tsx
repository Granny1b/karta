import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Lock } from 'lucide-react';
import type { LabelDef } from '@/domain/board';
import { colorValue } from '@/lib/colors';
import { formatDue } from '@/lib/format';
import { progressOf } from '@/state/selectors';
import { useBoardStore } from '@/state/boardStore';
import { cx } from '@/canvas/cx';
import { previewText } from '@/canvas/markdown';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import ProgressRing from '@/canvas/nodes/ProgressRing';
import { useCardDimmed, useLod, useMediaSrc } from '@/canvas/nodes/hooks';
import type { CardFlowNode } from '@/canvas/types';

const MAX_CHIPS = 2;

function LabelChips({ ids, labels }: { ids: string[]; labels: LabelDef[] }): JSX.Element | null {
  if (ids.length === 0 || labels.length === 0) return null;
  const found = ids
    .map((id) => labels.find((label) => label.id === id))
    .filter((label): label is LabelDef => label !== undefined);
  if (found.length === 0) return null;

  const shown = found.slice(0, MAX_CHIPS);
  const rest = found.length - shown.length;

  return (
    <>
      {shown.map((label) => (
        <span key={label.id} className="karta-chip" title={label.name}>
          <span className="karta-chip-dot" style={{ background: colorValue(label.color) }} />
          <span className="max-w-[64px] truncate">{label.name}</span>
        </span>
      ))}
      {rest > 0 && <span className="karta-chip">+{rest}</span>}
    </>
  );
}

/**
 * The workhorse node (spec 7.3). Colour is a 4 px bar down the left edge at
 * every level of detail except `block`, where the whole rectangle is the
 * colour and no text is drawn at all.
 */
function CardNodeView({ data, selected, dragging }: NodeProps<CardFlowNode>): JSX.Element {
  const card = data.node;
  const lod = useLod();
  const dimmed = useCardDimmed(card);
  const labels = useBoardStore((s) => s.doc?.labels);
  const cover = useMediaSrc(card.coverMediaId, 'thumb');

  const accent = colorValue(card.color);
  const progress = progressOf(card);
  const due = formatDue(card.dueDate);
  const title = card.title.trim().length > 0 ? card.title : 'Untitled';

  const root = cx(
    'karta-node',
    `karta-lod-${lod}`,
    selected && 'is-selected',
    dragging && 'is-dragging',
    card.locked && 'is-locked',
  );

  if (lod === 'block') {
    return (
      <div
        className={cx(root, 'karta-block')}
        style={{ background: accent, opacity: dimmed ? 0.25 : undefined }}
        title={title}
      >
        <NodeHandles connectable={!card.locked} />
      </div>
    );
  }

  return (
    <div className={root} style={{ opacity: dimmed ? 0.25 : undefined }} title={title}>
      <span className="karta-colorbar" style={{ background: accent }} aria-hidden />

      {lod === 'full' && (
        <div className="flex h-full flex-col gap-1 overflow-hidden py-2 pl-4 pr-2.5">
          {cover && (
            <img
              src={cover}
              alt=""
              draggable={false}
              className="h-14 w-full shrink-0 rounded-[3px] object-cover"
            />
          )}
          <div className="karta-card-title line-clamp-2">{title}</div>
          {card.body.trim().length > 0 && (
            <p className="line-clamp-2 text-[12px] leading-snug text-ink-muted">
              {previewText(card.body, 160)}
            </p>
          )}
          <div className="mt-auto flex min-h-[16px] flex-wrap items-center gap-1.5 pt-1">
            {progress.total > 0 && (
              <span className="flex items-center gap-1 text-[11px] tabular-nums text-ink-muted">
                <ProgressRing done={progress.done} total={progress.total} color={accent} />
                {progress.done}/{progress.total}
              </span>
            )}
            <LabelChips ids={card.labelIds} labels={labels ?? []} />
            {due.tone !== 'none' && (
              <span className={cx('karta-due', `karta-due-${due.tone}`)}>{due.text}</span>
            )}
            {card.locked && <Lock size={11} className="ml-auto text-ink-muted" aria-label="Locked" />}
          </div>
        </div>
      )}

      {lod === 'compact' && (
        <div className="flex h-full items-center gap-2 overflow-hidden py-2 pl-4 pr-2.5">
          {cover && (
            <img
              src={cover}
              alt=""
              draggable={false}
              className="h-9 w-9 shrink-0 rounded-[3px] object-cover"
            />
          )}
          <div className="karta-card-title line-clamp-3 min-w-0 flex-1">{title}</div>
          {progress.total > 0 && (
            <ProgressRing done={progress.done} total={progress.total} color={accent} size={18} />
          )}
        </div>
      )}

      {lod === 'title' && (
        <div className="flex h-full items-center overflow-hidden py-2 pl-4 pr-2.5">
          <div className="karta-card-title truncate">{title}</div>
        </div>
      )}

      <NodeHandles connectable={!card.locked} />
    </div>
  );
}

export default memo(CardNodeView);
