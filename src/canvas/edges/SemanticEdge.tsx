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
import type { KartaFlowEdge } from '@/canvas/types';

/** Labels stop being readable long before this, so they stop being drawn. */
const LABEL_MIN_ZOOM = 0.4;

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
      {selected && (
        <path d={path} fill="none" className="karta-edge-halo" strokeWidth={look.width + 6} />
      )}
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 20}
        style={{
          stroke,
          strokeWidth: selected ? look.width + 0.75 : look.width,
          strokeDasharray: look.dash,
        }}
      />
      {(showLabel || selected) && (
        <EdgeLabelRenderer>
          {showLabel && !selected && (
            <div
              className="karta-edge-label nodrag nopan"
              style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: stroke }}
            >
              {edge.label}
            </div>
          )}
          {selected && (
            <div
              className="karta-edge-toolbar-anchor nodrag nopan"
              style={{
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${1 / Math.max(zoom, 0.1)})`,
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
