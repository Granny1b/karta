import { memo, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { Handle, Position, useNodeId, useStore } from '@xyflow/react';
import { useBoardStore } from '@/state/boardStore';
import { cx } from '@/canvas/cx';
import {
  PERIMETER_HANDLE,
  choiceSize,
  hasEdgeBetween,
  planStubClick,
  rectCentre,
  sideFromHandleId,
} from '@/canvas/connect';
import { useCreateNode } from '@/canvas/dragCreate';
import { HANDLE_POSITION, HANDLE_SIDES } from '@/canvas/mapping';
import { useLod } from '@/canvas/nodes/hooks';
import '@/canvas/connect.css';

/**
 * What this node is, from the point of view of an arrow being dragged right
 * now: nothing at all, the thing it came from, somewhere it may land, or
 * somewhere it may not.
 */
type ConnectPhase = 'idle' | 'source' | 'open' | 'refused';

const STUB_TITLE = 'Drag to connect, or click to add a connected node';

/**
 * Every connection affordance a node wears (spec 7.3), drawn on one layer that
 * escapes the node's own overflow clip.
 *
 * There are two ways in, and they are the two draw.io has. The four stubs are
 * precise: they name a side, they are large enough to aim at, and a click on
 * one — rather than a drag — puts the same kind of node one step out and
 * connects it. The perimeter is forgiving: a drag off the edge of a node starts
 * an arrow without naming anything, and while that arrow is in the air every
 * other node becomes a target over its whole area, not over four dots.
 *
 * All five handles stay mounted at every zoom, because React Flow measures edge
 * anchors from them; only what they will accept changes.
 */
function NodeHandlesView({ connectable }: { connectable: boolean }): JSX.Element {
  const id = useNodeId();
  const lod = useLod();
  const create = useCreateNode();

  // One narrow subscription, and it answers `idle` before reading anything
  // else — a marquee drag must not pay for the connection machinery.
  const phase = useStore((s): ConnectPhase => {
    const connection = s.connection;
    if (!connection.inProgress || id === null) return 'idle';
    if (connection.fromNode.id === id) return 'source';
    if (!connectable) return 'refused';
    return hasEdgeBetween(s.edges, connection.fromNode.id, id) ? 'refused' : 'open';
  });

  const onStubClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const side = sideFromHandleId(event.currentTarget.dataset.handleid);
      if (side === null || id === null) return;
      // The click was aimed at the stub, not at the node behind it.
      event.stopPropagation();

      const doc = useBoardStore.getState().doc;
      const node = doc?.nodes.find((candidate) => candidate.id === id);
      if (!doc || !node || node.locked) return;

      // The same door every other creation path goes through, so the node and
      // its arrow land in one undo entry and the new node ends up selected.
      const plan = planStubClick(doc, node, side);
      const size = choiceSize(plan.choice);
      create(plan.choice, rectCentre({ ...plan.position, ...size }), {
        source: node.id,
        sides: plan.sides,
      });
    },
    [create, id],
  );

  const far = lod === 'title' || lod === 'block';

  return (
    <div className={cx('karta-connect-layer', far && 'is-far')}>
      <Handle
        id={PERIMETER_HANDLE}
        type="source"
        position={Position.Right}
        isConnectable={connectable}
        isConnectableStart={connectable}
        className={cx(
          'karta-connect-ring',
          !connectable && 'is-locked',
          phase === 'open' && 'is-open',
          phase === 'refused' && 'is-refused',
        )}
      />
      {HANDLE_SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={HANDLE_POSITION[side]}
          isConnectable={connectable}
          isConnectableStart={connectable}
          className="karta-port"
          title={STUB_TITLE}
          onClick={onStubClick}
        >
          <span className="karta-port-tab" aria-hidden />
        </Handle>
      ))}
    </div>
  );
}

export default memo(NodeHandlesView);
