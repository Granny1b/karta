import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { colorValue } from '@/lib/colors';
import { cx } from '@/canvas/cx';
import type { GroupFlowNode } from '@/canvas/types';

/**
 * A labelled frame. It paints behind everything and only its label takes the
 * pointer, so a drag started inside the frame is a marquee, not a move. Nodes
 * whose centre is inside travel with it — see `nodesInsideFrame` (spec 5.2).
 */
function GroupNodeView({ data, selected }: NodeProps<GroupFlowNode>): JSX.Element {
  const group = data.node;
  const accent = colorValue(group.color);

  return (
    <div
      className={cx('karta-frame', selected && 'is-selected')}
      style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 6%, transparent)` }}
    >
      <span
        className={cx('karta-group-grip', group.locked && 'is-locked')}
        style={{ borderColor: accent }}
      >
        <span className="karta-group-dot" style={{ background: accent }} aria-hidden />
        {group.title.trim().length > 0 ? group.title : 'Group'}
      </span>
    </div>
  );
}

export default memo(GroupNodeView);
