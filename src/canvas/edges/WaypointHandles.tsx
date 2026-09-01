import { memo, useCallback, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { MAX_WAYPOINTS, type Edge, type Waypoint } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { insertionIndex, segmentMidpoints, type Point } from '@/canvas/edgePath';

/**
 * The grips that make an arrow adjustable, in draw.io's vocabulary.
 *
 * A solid dot is a bend the user placed: drag it to move it, double-click to
 * take it out. A hollow dot sits at the middle of every segment: drag one and a
 * new bend is born there. Nothing is drawn until the edge is selected, so a
 * board full of arrows stays a board full of arrows.
 *
 * Positions are committed once, on pointer up, so bending an arrow is a single
 * undo entry rather than one per frame.
 */

const GRIP = 5;
/** The disc that catches the pointer — a 5 px dot is precise to look at and miserable to hit. */
const HIT = 11;
const GRID = 8;

interface Props {
  readonly edge: Edge;
  readonly points: readonly Point[];
}

type Drag =
  | { readonly kind: 'move'; readonly index: number }
  | { readonly kind: 'create'; readonly index: number };

const snap = (value: number, on: boolean): number => (on ? Math.round(value / GRID) * GRID : value);

function WaypointHandlesView({ edge, points }: Props): JSX.Element | null {
  const { screenToFlowPosition } = useReactFlow();
  const [drag, setDrag] = useState<Drag | null>(null);
  // Where the dragged grip is right now. Kept out of the document until the
  // gesture ends, so the store sees one change instead of sixty.
  const [live, setLive] = useState<Waypoint | null>(null);
  const moved = useRef(false);

  const commit = useCallback(
    (next: Waypoint[], label: string): void => {
      useBoardStore.getState().updateEdge(edge.id, { waypoints: next }, label);
    },
    [edge.id],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGCircleElement>, next: Drag): void => {
      // Left button only, and never let the canvas start a marquee under us.
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      moved.current = false;
      setDrag(next);
      setLive(null);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGCircleElement>): void => {
      if (drag === null) return;
      event.stopPropagation();
      moved.current = true;

      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const grid = !event.altKey;
      setLive({ x: snap(at.x, grid), y: snap(at.y, grid) });
    },
    [drag, screenToFlowPosition],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<SVGCircleElement>): void => {
      if (drag === null) return;
      event.stopPropagation();
      event.currentTarget.releasePointerCapture(event.pointerId);

      const at = live;
      setDrag(null);
      setLive(null);
      // A click that never moved is not a drag; leaving the document alone also
      // keeps a stray click out of the undo stack.
      if (at === null || !moved.current) return;

      const next = [...edge.waypoints];
      if (drag.kind === 'move') next[drag.index] = at;
      else next.splice(drag.index, 0, at);
      commit(next, drag.kind === 'move' ? 'Move a bend' : 'Bend an arrow');
    },
    [commit, drag, edge.waypoints, live],
  );

  const remove = useCallback(
    (event: React.MouseEvent<SVGCircleElement>, index: number): void => {
      event.stopPropagation();
      event.preventDefault();
      commit(
        edge.waypoints.filter((_, i) => i !== index),
        'Remove a bend',
      );
    },
    [commit, edge.waypoints],
  );

  const full = edge.waypoints.length >= MAX_WAYPOINTS;
  const midpoints = segmentMidpoints(points);

  return (
    <g className="karta-edge-grips">
      {/* A new bend, pulled out of the middle of a segment. */}
      {!full &&
        midpoints.map((mid, segment) => (
          <g key={`add:${segment}:${mid.x}:${mid.y}`}>
            <circle
              className="karta-edge-grip is-ghost"
              cx={drag?.kind === 'create' && live !== null ? live.x : mid.x}
              cy={drag?.kind === 'create' && live !== null ? live.y : mid.y}
              r={GRIP}
              pointerEvents="none"
            />
            <circle
              className="karta-edge-grip-hit"
              cx={drag?.kind === 'create' && live !== null ? live.x : mid.x}
              cy={drag?.kind === 'create' && live !== null ? live.y : mid.y}
              r={HIT}
              onPointerDown={(event) =>
                onPointerDown(event, {
                  kind: 'create',
                  index: insertionIndex(segment, points, edge.waypoints),
                })
              }
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </g>
        ))}

      {/* A bend that already exists. */}
      {edge.waypoints.map((point, index) => {
        const showing = drag?.kind === 'move' && drag.index === index && live !== null ? live : point;
        return (
          <g key={`at:${index}`}>
            <circle className="karta-edge-grip" cx={showing.x} cy={showing.y} r={GRIP} pointerEvents="none" />
            <circle
              className="karta-edge-grip-hit"
              cx={showing.x}
              cy={showing.y}
              r={HIT}
              onPointerDown={(event) => onPointerDown(event, { kind: 'move', index })}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={(event) => remove(event, index)}
            />
          </g>
        );
      })}
    </g>
  );
}

/**
 * Take every bend off an arrow. Reachable from the edge toolbar, because a
 * badly bent arrow is far quicker to reset than to unpick one dot at a time.
 */
export function clearWaypoints(edgeId: string): void {
  useBoardStore.getState().updateEdge(edgeId, { waypoints: [] }, 'Straighten an arrow');
  useUiStore.getState().toast('Arrow straightened');
}

export default memo(WaypointHandlesView);
