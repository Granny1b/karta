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
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import { MAX_SHAPE_LABEL, type ColorToken, type HexColor, type ShapeNode } from '@/domain/board';
import { TEMPER_TOKENS, colorValue } from '@/lib/colors';
import { cx } from '@/canvas/cx';
import { SHAPE_GEOMETRY, drawnSize } from '@/canvas/shapes';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import NodeResize from '@/canvas/nodes/NodeResize';
import { useLod } from '@/canvas/nodes/hooks';
import { useSoleNodeSelected } from '@/canvas/soleSelection';
import { useBoardStore } from '@/state/boardStore';
import type { ShapeFlowNode } from '@/canvas/types';

/** Secondary type, one step below a card title — a shape labels itself, it does not shout. */
const LABEL_SIZE = 13;
const LABEL_LEADING = 1.3;
const LINE_H = LABEL_SIZE * LABEL_LEADING;

/** The outline weight, matching the `relates` edge so a diagram reads as one drawing. */
const STROKE = 1.5;

/**
 * Trim a label to what the API will store (`MAX_SHAPE_LABEL`), never through
 * half a surrogate pair.
 *
 * `maxLength` on the field is the visible half of this rule; it is not the
 * enforceable half, because a programmatic paste bypasses it in several
 * browsers. A label one character over the cap is a document the API refuses,
 * and a refused document is refused again by every autosave after it — so the
 * cap is applied where the value is committed, not only where it is typed.
 */
export function capShapeLabel(value: string): string {
  if (value.length <= MAX_SHAPE_LABEL) return value;
  const cut = value.slice(0, MAX_SHAPE_LABEL);
  const last = cut.charCodeAt(cut.length - 1);
  const splitPair = last >= 0xd800 && last <= 0xdbff;
  return splitPair ? cut.slice(0, -1) : cut;
}

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

/* ------------------------------------------------------------------ *
 * The colour editor
 * ------------------------------------------------------------------ */

/** No fill: the swatch says so with the diagonal every drawing tool draws for it. */
const NO_FILL =
  'linear-gradient(to top right, transparent 46%, var(--line-strong) 46%, var(--line-strong) 54%, transparent 54%)';

interface SwatchRowProps {
  /** Ties the row's name to its group, so the swatches are read as "Fill: blue". */
  id: string;
  label: string;
  value: ColorToken | HexColor | null;
  /** How the "unset" choice at the head of the row paints and names itself. */
  unset: { background: string; title: string };
  onPick(color: ColorToken | null): void;
}

function SwatchRow({ id, label, value, unset, onPick }: SwatchRowProps): JSX.Element {
  return (
    <div className="karta-toolbar-row">
      <span className="karta-toolbar-label" id={id}>
        {label}
      </span>
      <div className="ml-auto flex items-center gap-1" role="group" aria-labelledby={id}>
        <button
          type="button"
          title={unset.title}
          aria-label={unset.title}
          aria-pressed={value === null}
          className={cx('karta-swatch', value === null && 'is-on')}
          style={{ background: unset.background }}
          onClick={() => onPick(null)}
        />
        {TEMPER_TOKENS.map((token) => (
          <button
            key={token}
            type="button"
            title={token}
            aria-label={token}
            aria-pressed={value === token}
            className={cx('karta-swatch', value === token && 'is-on')}
            style={{ background: colorValue(token) }}
            onClick={() => onPick(token)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The floating editor for a selected shape, in the language the arrow's already
 * speaks (`EdgeToolbar`): a counter-scaled surface with a field name and a row
 * of swatches, close enough to the thing it edits to be obviously about it.
 *
 * Fill and outline are what a shape vocabulary is *for* — a diagram is read by
 * its colours long before its labels — and they are the two things the 1–7
 * colour keys cannot reach, because those write `NodeBase.color`, which on a
 * shape only tints the outline. Without this panel `ShapeNode.fill` would be a
 * field nothing but the importer could ever write.
 *
 * Mounted only while this shape is the whole selection, for the reason
 * `soleSelection` gives: a marquee must not build an editing panel per node it
 * crosses, and a fill applies to one shape anyway.
 */
function ShapeToolbar({ shape }: { shape: ShapeNode }): JSX.Element | null {
  const sole = useSoleNodeSelected();
  if (!sole) return null;

  const set = (patch: Partial<Pick<ShapeNode, 'fill' | 'stroke'>>, label: string): void => {
    useBoardStore.getState().updateNode(shape.id, patch, label);
  };

  return (
    <NodeToolbar
      isVisible
      position={Position.Bottom}
      offset={12}
      className="nodrag nopan nowheel flex flex-col gap-1.5 border border-line bg-raised p-2"
      style={{ borderRadius: 'var(--karta-r-surface)', boxShadow: 'var(--karta-overlay-shadow)' }}
      role="group"
      aria-label="Shape colours"
    >
      <SwatchRow
        id={`fill-${shape.id}`}
        label="Fill"
        value={shape.fill}
        unset={{ background: NO_FILL, title: 'No fill' }}
        onPick={(fill) => set({ fill }, 'Shape fill')}
      />
      <SwatchRow
        id={`outline-${shape.id}`}
        label="Outline"
        value={shape.stroke}
        unset={{ background: 'var(--line-strong)', title: 'Default outline' }}
        onPick={(stroke) => set({ stroke }, 'Shape outline')}
      />
    </NodeToolbar>
  );
}

/* ------------------------------------------------------------------ *
 * The node
 * ------------------------------------------------------------------ */

/** The draw.io vocabulary on the canvas (spec 5.2): a silhouette and a centred label. */
function ShapeNodeView({ data, selected, dragging, width, height }: NodeProps<ShapeFlowNode>): JSX.Element {
  const shape = data.node;
  const lod = useLod();
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  // The box React Flow is showing, which is the drag box while a resize handle
  // is being pulled. The `viewBox` is set from it, so the silhouette is redrawn
  // at the size on screen instead of a stale drawing being stretched to it.
  const { w, h } = drawnSize(width, height, shape.size);
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
      const next = capShapeLabel(value);
      if (next === shape.label) return;
      useBoardStore.getState().updateNode(shape.id, { label: next }, 'Edit shape label');
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

  // The colour editor rides along at every level of detail: a shape too far out
  // to read a label on is still a shape whose fill can be changed, and it is
  // the colours that are legible at that distance.
  const toolbar = selected === true && !shape.locked ? <ShapeToolbar shape={shape} /> : null;

  // Below 0.25 the shape is a filled silhouette and nothing else (spec 7.3).
  if (lod === 'block') {
    return (
      <>
        <NodeResize node={shape} selected={selected === true} />
        {toolbar}
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
      {toolbar}
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
              // Exactly what `api/src/domain/validate.ts` accepts, from the same
              // constant — the field cannot type a board that cannot be saved.
              maxLength={MAX_SHAPE_LABEL}
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
