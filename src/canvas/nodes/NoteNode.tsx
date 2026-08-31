import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { colorValue } from '@/lib/colors';
import { cx } from '@/canvas/cx';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import { useLod } from '@/canvas/nodes/hooks';
import type { NoteFlowNode } from '@/canvas/types';

/** A sticky: text and a colour, nothing else (spec 5.2). */
function NoteNodeView({ data, selected, dragging }: NodeProps<NoteFlowNode>): JSX.Element {
  const note = data.node;
  const lod = useLod();
  const accent = colorValue(note.color);
  const text = note.text.trim();

  const root = cx(
    'karta-node karta-note',
    `karta-lod-${lod}`,
    selected && 'is-selected',
    dragging && 'is-dragging',
    note.locked && 'is-locked',
  );

  if (lod === 'block') {
    return (
      <div className={cx(root, 'karta-block')} style={{ background: accent }} title={text}>
        <NodeHandles connectable={!note.locked} />
      </div>
    );
  }

  const clamp = lod === 'full' ? 'line-clamp-6' : lod === 'compact' ? 'line-clamp-3' : 'truncate';

  return (
    <div
      className={root}
      style={{ background: `color-mix(in srgb, ${accent} 14%, var(--surface-raised))` }}
      title={text}
    >
      <span className="karta-colorbar" style={{ background: accent }} aria-hidden />
      <div className="flex h-full flex-col overflow-hidden py-2 pl-4 pr-2.5">
        {text.length > 0 ? (
          <p className={cx('whitespace-pre-wrap text-[13px] leading-snug text-ink', clamp)}>{text}</p>
        ) : (
          <p className="text-[13px] italic leading-snug text-ink-muted">Empty note</p>
        )}
      </div>
      <NodeHandles connectable={!note.locked} />
    </div>
  );
}

export default memo(NoteNodeView);
