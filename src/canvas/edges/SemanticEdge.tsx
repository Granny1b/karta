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
import { EDGE_STYLE, edgeColor } from '@/lib/colors';
import EdgeToolbar from '@/canvas/EdgeToolbar';
import { cx } from '@/canvas/cx';
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

  const [path, labelX, labelY] =
    edge.routing === 'straight'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : edge.routing === 'smoothstep'
        ? getSmoothStepPath({ ...geometry, borderRadius: 8 })
        : getBezierPath(geometry);

  const showLabel = edge.label !== null && edge.label.length > 0 && zoom >= LABEL_MIN_ZOOM;

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
      {(showLabel || selected === true) && (
        <EdgeLabelRenderer>
          {showLabel && selected !== true && (
            <div
              className="karta-edge-label karta-edge-chip nodrag nopan"
              style={{
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                // Quietly tinted by the arrow it names, without competing with it.
                borderColor: `color-mix(in srgb, ${stroke} 55%, var(--line))`,
              }}
            >
              {edge.label}
            </div>
          )}
          {selected === true && (
            <div
              className="karta-edge-toolbar-anchor nodrag nopan"
              style={{
                /*
                 * Anchor, then undo the camera, then place the panel — in that
                 * order, so the toolbar is the same size and sits the same
                 * distance above the line at every zoom.
                 */
                transform: `translate(${labelX}px, ${labelY}px) scale(${1 / Math.max(zoom, 0.1)}) translate(-50%, calc(-100% - ${TOOLBAR_GAP}px))`,
              }}
            >
              <EdgeToolbar edge={edge} />
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(SemanticEdgeView);
