import { NodeResizer } from '@xyflow/react';
import type { BoardNode } from '@/domain/board';
import { MIN_NODE_SIZE } from '@/canvas/resize';
import { useNodeResize } from '@/canvas/nodes/hooks';

/**
 * The resize affordance every sizeable node wears (spec 10, phase 1): edges and
 * corners while the node is selected, nothing at all while it is locked. The
 * grid comes from React Flow's own `snapToGrid`, so a resized node lands on the
 * same 8 px lattice a dragged one does — and steps off it with `Alt` held.
 */
export default function NodeResize({ node, selected }: { node: BoardNode; selected: boolean }): JSX.Element | null {
  const onResizeEnd = useNodeResize(node);
  if (node.locked) return null;

  const min = MIN_NODE_SIZE[node.kind];
  return (
    <NodeResizer
      isVisible={selected}
      minWidth={min.w}
      minHeight={min.h}
      handleClassName="karta-resize-handle"
      lineClassName="karta-resize-line"
      onResizeEnd={onResizeEnd}
    />
  );
}
