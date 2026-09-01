import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useStore,
  type EdgeProps,
} from '@xyflow/react';
import type { Edge } from '@/domain/board';
import { EDGE_STYLE, edgeColor } from '@/lib/colors';
import EdgeToolbar from '@/canvas/EdgeToolbar';
import { cx } from '@/canvas/cx';
import { routeThrough } from '@/canvas/edgePath';
import WaypointHandles from '@/canvas/edges/WaypointHandles';
import { useSoleEdgeSelected } from '@/canvas/soleSelection';
import type { KartaFlowEdge } from '@/canvas/types';

/** Labels stop being readable long before this, so they stop being drawn. */
const LABEL_MIN_ZOOM = 0.4;

/**
 * A 1.5 px line is a hard thing to hit. The stroke the pointer answers to is
 * this wide and invisible, so selecting an arrow is not a test of aim.
 */
const HIT_WIDTH = 26;

/** How far the halo stands off the line it belongs to. */
const HALO_SPREAD = 7;

/** Clear of the line, so the toolbar never sits on top of what it is editing. */
const TOOLBAR_GAP = 12;

/**
 * One component for every arrow (spec 5.3): the semantic picks the colour, dash
 * and marker; the routing picks the path function; the colour field overrides
 * the semantic default.
 */
function SemanticEdgeView({
  data,
  selected,
  markerEnd,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  interactionWidth,
}: EdgeProps<KartaFlowEdge>): JSX.Element | null {
  const zoom = useStore((s) => s.transform[2]);
  const edge = data?.edge;
  if (!edge) return null;

  const look = EDGE_STYLE[edge.semantic];
  const stroke = edgeColor(edge.semantic, edge.color);
  const geometry = {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  };

  // An edge the user has bent is routed here rather than by React Flow, whose
  // path helpers know only two endpoints. An unbent one keeps the library's
  // geometry, so nothing about the ordinary case changes.
  const bent = edge.waypoints.length > 0;
  const custom = bent
    ? routeThrough({
        source: { x: sourceX, y: sourceY },
        target: { x: targetX, y: targetY },
        sourceSide: edge.sourceHandle,
        targetSide: edge.targetHandle,
        waypoints: edge.waypoints,
        stepped: edge.routing !== 'straight',
      })
    : null;

  const [libraryPath, libraryLabelX, libraryLabelY] =
    edge.routing === 'straight'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : edge.routing === 'smoothstep'
        ? getSmoothStepPath({ ...geometry, borderRadius: 8 })
        : getBezierPath(geometry);

  const path = custom?.path ?? libraryPath;
  const points = custom?.points ?? [];
  // The label rides the middle bend of a bent edge, so it does not sit on top
  // of a corner it has nothing to do with.
  const middle = bent ? points[Math.floor(points.length / 2)] : undefined;
  const labelX = middle?.x ?? libraryLabelX;
  const labelY = middle?.y ?? libraryLabelY;

  // The words the arrow carries, once they are big enough to be words.
  const chip =
    edge.label !== null && edge.label.length > 0 && zoom >= LABEL_MIN_ZOOM ? edge.label : null;

  return (
    <>
      {/*
        Always drawn, never visible until it is asked for: hover and selection
        are the same shape at two strengths, which is one idea instead of two.
      */}
      <path
        d={path}
        fill="none"
        className={cx('karta-edge-halo', selected === true && 'is-on')}
        strokeWidth={look.width + HALO_SPREAD}
      />
      {selected === true && (
        <WaypointHandles edge={edge} points={points.length > 0 ? points : []} />
      )}
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? HIT_WIDTH}
        style={{
          stroke,
          strokeWidth: look.width,
          strokeDasharray: look.dash,
          // A dash is a row of ticks; rounding the ends would close the gaps.
          strokeLinecap: look.dash === undefined ? 'round' : 'butt',
          strokeLinejoin: 'round',
        }}
      />
      {(chip !== null || selected === true) && (
        <EdgeLabelRenderer>
          {selected === true ? (
            <SelectedEdgeChrome
              edge={edge}
              label={chip}
              stroke={stroke}
              x={labelX}
              y={labelY}
              zoom={zoom}
            />
          ) : chip !== null ? (
            <EdgeChip text={chip} stroke={stroke} x={labelX} y={labelY} />
          ) : null}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** The arrow's own words, quietly tinted by the line they name. */
function EdgeChip({
  text,
  stroke,
  x,
  y,
}: {
  text: string;
  stroke: string;
  x: number;
  y: number;
}): JSX.Element {
  return (
    <div
      className="karta-edge-label karta-edge-chip nodrag nopan"
      style={{
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        borderColor: `color-mix(in srgb, ${stroke} 55%, var(--line))`,
      }}
    >
      {text}
    </div>
  );
}

/**
 * What a selected arrow shows.
 *
 * The editor belongs to one arrow. A marquee selects every arrow it crosses,
 * and a panel per arrow is neither usable nor free — each is some forty
 * elements, two store subscriptions and a field of its own, built and thrown
 * away again as the rectangle grows. So an arrow caught in a crowd keeps its
 * label and wears the halo, and the panel goes to the arrow that *is* the
 * selection.
 */
function SelectedEdgeChrome({
  edge,
  label,
  stroke,
  x,
  y,
  zoom,
}: {
  edge: Edge;
  label: string | null;
  stroke: string;
  x: number;
  y: number;
  zoom: number;
}): JSX.Element | null {
  const sole = useSoleEdgeSelected();
  if (!sole) return label === null ? null : <EdgeChip text={label} stroke={stroke} x={x} y={y} />;

  return (
    <div
      className="karta-edge-toolbar-anchor nodrag nopan"
      style={{
        /*
         * Anchor, then undo the camera, then place the panel — in that order,
         * so the toolbar is the same size and sits the same distance above the
         * line at every zoom.
         */
        transform: `translate(${x}px, ${y}px) scale(${1 / Math.max(zoom, 0.1)}) translate(-50%, calc(-100% - ${TOOLBAR_GAP}px))`,
      }}
    >
      <EdgeToolbar edge={edge} />
    </div>
  );
}

export default memo(SemanticEdgeView);
