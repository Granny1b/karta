import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { ImageOff } from 'lucide-react';
import { cx } from '@/canvas/cx';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import { useLod, useMediaSrc } from '@/canvas/nodes/hooks';
import type { ImageFlowNode } from '@/canvas/types';

/** A screenshot on the canvas. Below `full` the thumbnail is used (spec 7.3). */
function ImageNodeView({ data, selected, dragging }: NodeProps<ImageFlowNode>): JSX.Element {
  const image = data.node;
  const lod = useLod();
  const src = useMediaSrc(image.mediaId, lod === 'full' ? 'full' : 'thumb');
  const caption = image.caption?.trim() ?? '';
  const showCaption = lod === 'full' && caption.length > 0;

  const root = cx(
    'karta-node karta-image',
    `karta-lod-${lod}`,
    selected && 'is-selected',
    dragging && 'is-dragging',
    image.locked && 'is-locked',
  );

  return (
    <div className={root} title={caption.length > 0 ? caption : undefined}>
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 bg-sunken">
          {src ? (
            <img
              src={src}
              alt={caption}
              draggable={false}
              className={cx('h-full w-full', image.fit === 'cover' ? 'object-cover' : 'object-contain')}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-muted">
              <ImageOff size={18} aria-label="Image unavailable" />
            </div>
          )}
        </div>
        {showCaption && (
          <div className="shrink-0 truncate border-t border-line px-2 py-1 text-[11px] text-ink-muted">
            {caption}
          </div>
        )}
      </div>
      <NodeHandles connectable={!image.locked} />
    </div>
  );
}

export default memo(ImageNodeView);
