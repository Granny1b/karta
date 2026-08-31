import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ColorToken, HexColor } from '@/domain/board';
import { colorValue } from '@/lib/colors';
import { cx } from '@/canvas/cx';
import { SHAPE_GEOMETRY } from '@/canvas/shapes';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import NodeResize from '@/canvas/nodes/NodeResize';
import { useLod } from '@/canvas/nodes/hooks';
import { useBoardStore } from '@/state/boardStore';
import type { ShapeFlowNode } from '@/canvas/types';

/** Secondary type, one step below a card title — a shape labels itself, it does not shout. */
const LABEL_SIZE = 13;
const LABEL_LEADING = 1.3;
const LINE_H = LABEL_SIZE * LABEL_LEADING;

/** The outline weight, matching the `relates` edge so a diagram reads as one drawing. */
const STROKE = 1.5;

/**
 * A fill is a *tint*, the way a sticky is (spec 8.1): the colour reads at a
 * glance and the label stays legible on it, in either theme. A solid temper
 * colour would make black ink on a shape unreadable and the board loud.
 */
function fillPaint(fill: ColorToken | HexColor | null): string {
  if (fill === null) return 'none';
  return `color-mix(in srgb, ${colorValue(fill)} 16%, var(--surface-raised))`;
}

/**
 * The outline: an explicit stroke wins, then the fill at full strength, then
 * the node's own colour — so the 1–7 colour keys reach a shape — and finally
 * the hairline every uncoloured shape wears.
 */
function strokePaint(
  stroke: ColorToken | HexColor | null,
  fill: ColorToken | HexColor | null,
  color: ColorToken | HexColor | null,
): string {
  if (stroke !== null) return colorValue(stroke);
  if (fill !== null) return colorValue(fill);
  if (color !== null) return colorValue(color);
  return 'var(--line-strong)';
}

/** The draw.io vocabulary on the canvas (spec 5.2): a silhouette and a centred label. */
function ShapeNodeView({ data, selected, dragging }: NodeProps<ShapeFlowNode>): JSX.Element {
  const shape = data.node;
  const lod = useLod();
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  // Never zero: a `viewBox` of no width draws nothing at all.
  const w = Math.max(1, shape.size.w);
  const h = Math.max(1, shape.size.h);
  const geometry = SHAPE_GEOMETRY[shape.shape];
  const d = geometry.path(w, h);
  const inset = geometry.labelInset(w, h);

  const fill = fillPaint(shape.fill);
  const stroke = strokePaint(shape.stroke, shape.fill, shape.color);
  const label = shape.label.trim();

  const beginEdit = useCallback(
    (event: ReactMouseEvent): void => {
      if (shape.locked) return;
      event.stopPropagation();
      setDraft(shape.label);
    },
    [shape.locked, shape.label],
  );

  const commit = useCallback(
    (value: string): void => {
      setDraft(null);
      if (value === shape.label) return;
      useBoardStore.getState().updateNode(shape.id, { label: value }, 'Edit shape label');
    },
    [shape.id, shape.label],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
      // A shape label is a caption, not a paragraph: Enter finishes it, and
      // Shift+Enter is there for the rare two-line one.
      if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        commit(event.currentTarget.value);
      }
    },
    [commit],
  );

  // The field opens with the old label selected, and grows with what is typed.
  useLayoutEffect(() => {
    const el = input.current;
    if (el === null || draft === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  // The box a label lives in, in per cent, so it tracks a live resize as the
  // silhouette does. Both the reading and the editing view use it, which is
  // what keeps the text from jumping when the field opens.
  const labelBox: CSSProperties = {
    left: `${(inset.x / w) * 100}%`,
    top: `${(inset.y / h) * 100}%`,
    width: `${(inset.w / w) * 100}%`,
    height: `${(inset.h / h) * 100}%`,
  };
  const labelType: CSSProperties = { fontSize: LABEL_SIZE, lineHeight: LABEL_LEADING };

  const root = cx(
    'relative h-full w-full',
    `karta-lod-${lod}`,
    shape.locked && 'cursor-default',
    editing && 'nodrag',
  );

  // Below 0.25 the shape is a filled silhouette and nothing else (spec 7.3).
  if (lod === 'block') {
    return (
      <>
        <NodeResize node={shape} selected={selected === true} />
        <div className={root} title={label.length > 0 ? label : undefined}>
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d={d} style={{ fill: shape.fill === null ? stroke : colorValue(shape.fill) }} />
          </svg>
          <NodeHandles connectable={!shape.locked} />
        </div>
      </>
    );
  }

  // As many lines as the label area actually holds, fewer as the camera pulls back.
  const fits = Math.max(1, Math.floor(inset.h / LINE_H));
  const lines = lod === 'title' ? 1 : lod === 'compact' ? Math.min(2, fits) : fits;

  return (
    <>
      {/* Outside the silhouette: half of every resize handle hangs over the edge. */}
      <NodeResize node={shape} selected={selected === true} />
      <div className={root} onDoubleClick={beginEdit} title={label.length > 0 ? label : undefined}>
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          // The stroke sits on the box edge, where its outer half would be
          // clipped; the shape is drawn to the box, so it is let through.
          style={{
            overflow: 'visible',
            filter: dragging === true ? 'drop-shadow(0 8px 14px rgb(0 0 0 / 18%))' : undefined,
          }}
          aria-hidden
        >
          {selected === true && (
            // Selection hugs the outline instead of boxing it — the same halo
            // a selected edge wears, so one language covers both.
            <path
              d={d}
              style={{
                fill: 'none',
                stroke: 'var(--focus)',
                strokeWidth: STROKE + 4,
                strokeOpacity: 0.22,
                strokeLinejoin: 'round',
              }}
            />
          )}
          <path
            d={d}
            style={{
              fill,
              stroke: selected === true ? 'var(--focus)' : stroke,
              strokeWidth: STROKE,
              strokeLinejoin: 'round',
            }}
          />
        </svg>

        <div className="absolute flex items-center justify-center" style={labelBox}>
          {editing ? (
            <textarea
              ref={input}
              className="nodrag nowheel w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-center text-ink outline-none"
              style={labelType}
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={(event) => commit(event.currentTarget.value)}
              onKeyDown={onKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            />
          ) : (
            label.length > 0 && (
              <div
                className="w-full overflow-hidden break-words text-center text-ink"
                style={{
                  ...labelType,
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: lines,
                }}
              >
                {label}
              </div>
            )
          )}
        </div>

        <NodeHandles connectable={!shape.locked} />
      </div>
    </>
  );
}

export default memo(ShapeNodeView);
