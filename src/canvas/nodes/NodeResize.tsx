import { NodeResizer } from '@xyflow/react';
import type { BoardNode } from '@/domain/board';
import { MIN_NODE_SIZE } from '@/canvas/resize';
import { useNodeResize } from '@/canvas/nodes/hooks';
import { useSoleNodeSelected } from '@/canvas/soleSelection';

/**
 * The resize affordance every sizeable node wears (spec 10, phase 1): edges and
 * corners while the node is the one being worked on, nothing at all while it is
 * locked. The grid comes from React Flow's own `snapToGrid`, so a resized node
 * lands on the same 8 px lattice a dragged one does — and steps off it with
 * `Alt` held.
 *
 * Nothing is mounted, and no hook runs, for a node that is not selected: the
 * resizer is twelve controls, each with its own store subscription and drag
 * behaviour, and a marquee would otherwise build them for every node it crossed
 * and tear them down again the moment the rectangle moved on.
 */
export default function NodeResize({ node, selected }: { node: BoardNode; selected: boolean }): JSX.Element | null {
  if (node.locked || !selected) return null;
  return <SelectedNodeResize node={node} />;
}

/** Selected — but handles are only worth drawing when this node is the selection. */
function SelectedNodeResize({ node }: { node: BoardNode }): JSX.Element | null {
  const onResizeEnd = useNodeResize(node);
  const sole = useSoleNodeSelected();
  if (!sole) return null;

  const min = MIN_NODE_SIZE[node.kind];
  return (
    <NodeResizer
      minWidth={min.w}
      minHeight={min.h}
      handleClassName="karta-resize-handle"
      lineClassName="karta-resize-line"
      onResizeEnd={onResizeEnd}
    />
  );
}
