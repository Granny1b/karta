import { memo } from 'react';
import { Handle } from '@xyflow/react';
import { HANDLE_POSITION, HANDLE_SIDES } from '@/canvas/mapping';

/**
 * The four connection points every node exposes. They stay mounted at all zoom
 * levels — React Flow measures edge anchors from them — and are revealed on
 * hover by `canvas.css` (spec 7.3).
 */
function NodeHandlesView({ connectable }: { connectable: boolean }): JSX.Element {
  return (
    <>
      {HANDLE_SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={HANDLE_POSITION[side]}
          className="karta-handle"
          isConnectable={connectable}
        />
      ))}
    </>
  );
}

export default memo(NodeHandlesView);
