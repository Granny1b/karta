import { memo, useCallback, type MouseEvent } from 'react';
import type { NodeProps } from '@xyflow/react';
import { SquareArrowOutUpRight } from 'lucide-react';
import { colorValue } from '@/lib/colors';
import { cx } from '@/canvas/cx';
import { useCanvasApi } from '@/canvas/CanvasContext';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import { useLod } from '@/canvas/nodes/hooks';
import type { BoardLinkFlowNode } from '@/canvas/types';

/** The doorway to a nested board, with the rollup the index keeps fresh (spec 5.2). */
function BoardLinkNodeView({ data, selected, dragging }: NodeProps<BoardLinkFlowNode>): JSX.Element {
  const link = data.node;
  const lod = useLod();
  const { navigateToBoard } = useCanvasApi();
  const accent = colorValue(link.color);
  const title = link.cachedTitle.trim().length > 0 ? link.cachedTitle : 'Board';
  const counts = link.cachedCounts;

  const open = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      navigateToBoard(link.targetBoardId);
    },
    [navigateToBoard, link.targetBoardId],
  );

  const root = cx(
    'karta-node karta-boardlink',
    `karta-lod-${lod}`,
    selected && 'is-selected',
    dragging && 'is-dragging',
  );

  if (lod === 'block') {
    return (
      <div className={cx(root, 'karta-block')} style={{ background: accent }} onDoubleClick={open} title={title}>
        <NodeHandles connectable={!link.locked} />
      </div>
    );
  }

  return (
    <div className={root} onDoubleClick={open} title={`${title} — double-click to open`}>
      <span className="karta-colorbar" style={{ background: accent }} aria-hidden />
      <div className="flex h-full flex-col justify-center gap-1.5 overflow-hidden py-2 pl-4 pr-2.5">
        <div className="flex items-center gap-1.5">
          <SquareArrowOutUpRight size={14} className="shrink-0 text-ink-muted" aria-hidden />
          <div className="karta-card-title truncate">{title}</div>
        </div>
        {lod !== 'title' && (
          <div className="text-[12px] text-ink-muted">
            {counts && counts.total > 0
              ? `${counts.done} of ${counts.total} done`
              : counts
                ? 'No cards yet'
                : 'Nested board'}
          </div>
        )}
      </div>
      <NodeHandles connectable={!link.locked} />
    </div>
  );
}

export default memo(BoardLinkNodeView);
