import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { NodeToolbar, Position, useStoreApi, type NodeProps } from '@xyflow/react';
import { AlignCenter, AlignLeft, AlignRight, Minus, Plus } from 'lucide-react';
import {
  DEFAULT_TEXT_SIZE,
  MAX_NODE_TEXT,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  capNodeText,
  type TextNode,
} from '@/domain/board';
import { colorValue } from '@/lib/colors';
import { isEditableTarget } from '@/lib/keys';
import { cx } from '@/canvas/cx';
import { insideDialog } from '@/canvas/useCanvasShortcuts';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import NodeResize from '@/canvas/nodes/NodeResize';
import { useLod } from '@/canvas/nodes/hooks';
import { useSoleNodeSelected } from '@/canvas/soleSelection';
import { useBoardStore } from '@/state/boardStore';
import type { TextFlowNode } from '@/canvas/types';

/**
 * Reading leading for canvas text. It is also the number that makes the
 * default text node exactly one line tall: 20 px × 1.6 + 2 × 8 px = 48 px,
 * which is `DEFAULT_NODE_SIZE.text.h`.
 */
const LEADING = 1.6;
/** The only inset text keeps, so a heading lines up with the cards beneath it. */
const PAD = 8;

const WEIGHT: Record<'regular' | 'bold', number> = { regular: 400, bold: 600 };

/* ------------------------------------------------------------------ *
 * The toolbar
 * ------------------------------------------------------------------ */

/**
 * The sizes the stepper walks, from the smallest legible to the largest that
 * is still a heading rather than a wall. A caption, body, subhead, heading and
 * poster ladder — the steps a person actually wants — instead of ±1 px, which
 * is 192 clicks from one end to the other.
 *
 * It begins at `MIN_TEXT_SIZE` and ends at `MAX_TEXT_SIZE` on purpose: those
 * are the bounds `api/src/domain/validate.ts` refuses a document outside, so
 * the control cannot reach a size that cannot be saved.
 */
export const TEXT_SIZE_STEPS: readonly number[] = [
  MIN_TEXT_SIZE, 10, 12, 14, 16, 20, 24, 32, 40, 56, 72, 96, 128, MAX_TEXT_SIZE,
];

/**
 * Any stored size, brought inside what the API accepts. A size is not rounded
 * on the way through: an imported 24.5 px is a legal size, and rounding it
 * here would make the stepper skip the rung it is standing next to.
 */
export function clampTextSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEXT_SIZE;
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, value));
}

/**
 * The next size up or down the ladder. A size that is not on the ladder — one
 * that arrived through JSON import — steps to the nearest rung in that
 * direction rather than snapping to the whole ladder, and the ends hold.
 */
export function stepTextSize(current: number, direction: 1 | -1): number {
  const from = clampTextSize(current);
  if (direction === 1) {
    return TEXT_SIZE_STEPS.find((step) => step > from) ?? MAX_TEXT_SIZE;
  }
  let below = MIN_TEXT_SIZE;
  for (const step of TEXT_SIZE_STEPS) {
    if (step < from) below = step;
  }
  return below;
}

const ALIGNS: ReadonlyArray<{ value: TextNode['align']; label: string; Icon: typeof AlignLeft }> = [
  { value: 'left', label: 'Left', Icon: AlignLeft },
  { value: 'center', label: 'Centre', Icon: AlignCenter },
  { value: 'right', label: 'Right', Icon: AlignRight },
];

const WEIGHTS: ReadonlyArray<{ value: TextNode['weight']; label: string }> = [
  { value: 'regular', label: 'Regular' },
  { value: 'bold', label: 'Bold' },
];

/**
 * The floating editor for a selected text node, in the language the arrow and
 * the shape already speak: a counter-scaled surface of named rows, close
 * enough to the thing it edits to be obviously about it.
 *
 * Size, alignment and weight are what free text is *for* — a heading over a
 * cluster is a heading because it is bigger and bolder than what it heads —
 * and until this existed they were three fields only the importer could write:
 * every text node made on the board was 20 px, left, regular, for ever.
 *
 * Mounted only while this node is the whole selection, for the reason
 * `soleSelection` gives: a marquee must not build an editing panel per node it
 * crosses, and a size applies to one node anyway.
 */
function TextToolbar({ text }: { text: TextNode }): JSX.Element | null {
  const sole = useSoleNodeSelected();
  if (!sole) return null;

  const set = (
    patch: Partial<Pick<TextNode, 'fontSize' | 'align' | 'weight'>>,
    label: string,
  ): void => {
    useBoardStore.getState().updateNode(text.id, patch, label);
  };

  const size = clampTextSize(text.fontSize);
  const resize = (direction: 1 | -1): void => {
    const next = stepTextSize(size, direction);
    if (next !== text.fontSize) set({ fontSize: next }, 'Text size');
  };

  return (
    <NodeToolbar
      isVisible
      position={Position.Bottom}
      offset={12}
      className="nodrag nopan nowheel flex flex-col gap-1.5 border border-line bg-raised p-2"
      style={{ borderRadius: 'var(--karta-r-surface)', boxShadow: 'var(--karta-overlay-shadow)' }}
      role="group"
      aria-label="Text"
    >
      <div className="karta-toolbar-row">
        <span className="karta-toolbar-label" id={`size-${text.id}`}>
          Size
        </span>
        <div className="karta-toolbar-seg ml-auto" role="group" aria-labelledby={`size-${text.id}`}>
          <button
            type="button"
            title="Smaller"
            aria-label="Smaller"
            disabled={size <= MIN_TEXT_SIZE}
            className="karta-tool-btn karta-tool-icon disabled:cursor-default disabled:opacity-40"
            onClick={() => resize(-1)}
          >
            <Minus size={13} />
          </button>
          {/* The number itself, so the control says what it did — to the
              pixel, since a fraction of one is nothing anybody set on purpose. */}
          <span
            className="w-8 text-center tabular-nums text-ink"
            style={{ fontSize: 'var(--karta-t-meta)', lineHeight: '22px' }}
          >
            {Math.round(size)}
          </span>
          <button
            type="button"
            title="Bigger"
            aria-label="Bigger"
            disabled={size >= MAX_TEXT_SIZE}
            className="karta-tool-btn karta-tool-icon disabled:cursor-default disabled:opacity-40"
            onClick={() => resize(1)}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="karta-toolbar-row">
        <span className="karta-toolbar-label" id={`align-${text.id}`}>
          Align
        </span>
        <div className="karta-toolbar-seg ml-auto" role="group" aria-labelledby={`align-${text.id}`}>
          {ALIGNS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={text.align === value}
              className={cx('karta-tool-btn karta-tool-icon', text.align === value && 'is-on')}
              onClick={() => set({ align: value }, 'Text alignment')}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>

      <div className="karta-toolbar-row">
        <span className="karta-toolbar-label" id={`weight-${text.id}`}>
          Weight
        </span>
        <div
          className="karta-toolbar-seg ml-auto"
          role="group"
          aria-labelledby={`weight-${text.id}`}
        >
          {WEIGHTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-pressed={text.weight === value}
              className={cx('karta-tool-btn', text.weight === value && 'is-on')}
              onClick={() => set({ weight: value }, 'Text weight')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </NodeToolbar>
  );
}

/* ------------------------------------------------------------------ *
 * The node
 * ------------------------------------------------------------------ */

/**
 * Words laid straight onto the board (spec 5.2) — a heading over a cluster, an
 * aside beside a diagram. No frame, no fill, no colour bar: the node *is* its
 * text, and `NodeBase.color` is the ink. The box only ever grows to hold what
 * is written, so text is never clipped by a size nobody chose.
 */
function TextNodeView({ data, selected }: NodeProps<TextFlowNode>): JSX.Element {
  const text = data.node;
  const lod = useLod();
  const flow = useStoreApi();
  const [draft, setDraft] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  const ink = text.color === null ? 'var(--ink)' : colorValue(text.color);
  const body = text.text;

  /** One typography, shared by the reading view and the field, so nothing shifts. */
  const type: CSSProperties = {
    padding: PAD,
    fontSize: text.fontSize,
    lineHeight: LEADING,
    fontWeight: WEIGHT[text.weight],
    textAlign: text.align,
    color: ink,
  };

  const beginEdit = useCallback((): void => {
    if (text.locked) return;
    setDraft(text.text);
  }, [text.locked, text.text]);

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent): void => {
      event.stopPropagation();
      beginEdit();
    },
    [beginEdit],
  );

  /**
   * Committing writes the fitted height with the text, in one undo entry, so
   * the box never lags a line behind what it holds. An unchanged draft — the
   * Escape you press straight after opening the field — writes nothing at all.
   *
   * The body is capped here as well as on the field: `maxLength` stops typing
   * and not a programmatic paste, and one character over `MAX_NODE_TEXT` is a
   * document the API refuses — and refuses again on every autosave after it.
   */
  const commit = useCallback(
    (value: string): void => {
      const fit = input.current?.scrollHeight ?? 0;
      setDraft(null);
      const next = capNodeText(value);
      if (next === text.text) return;
      const patch: Record<string, unknown> = { text: next };
      // A measured height belongs to the text that was measured. When the cap
      // cut some of it away, the observer below fits the box to what is left.
      const whole = next.length === value.length;
      if (whole && fit > 0 && fit !== text.size.h) patch.size = { w: text.size.w, h: fit };
      useBoardStore.getState().updateNode(text.id, patch, 'Edit text');
    },
    [text.id, text.text, text.size.h, text.size.w],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
      // Enter belongs to the text — this is a paragraph, not a caption.
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      commit(event.currentTarget.value);
    },
    [commit],
  );

  // The field opens with the caret at the end and grows as it is typed into.
  useLayoutEffect(() => {
    const el = input.current;
    if (el === null || draft === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = input.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  /**
   * Nothing else measures text, so the node does: whenever the rendered block
   * is taller than the box — a paste, an import, a narrower resize, a font
   * that finished loading — the box grows to hold it. Silently, because a
   * height nobody asked for is not an undo step.
   */
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null || editing || text.locked) return undefined;

    const fit = (): void => {
      const height = el.offsetHeight;
      if (height <= 0) return;
      const store = useBoardStore.getState();
      const current = store.doc?.nodes.find((n) => n.id === text.id);
      if (!current || current.size.h >= height) return;
      store.mutateSilent((d) => {
        const node = d.nodes.find((n) => n.id === text.id);
        if (node) node.size = { ...node.size, h: height };
      });
    };

    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editing, lod, text.id, text.locked]);

  /**
   * Enter opens the field when this text node is the whole selection — the
   * canvas gives Enter to the card editor, which free text has no use for.
   */
  useEffect(() => {
    if (selected !== true || editing || text.locked) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target) || insideDialog(event.target)) return;
      const chosen = flow.getState().nodes.filter((n) => n.selected);
      if (chosen.length !== 1 || chosen[0]?.id !== text.id) return;
      event.preventDefault();
      beginEdit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beginEdit, editing, flow, selected, text.id, text.locked]);

  // A ring is the whole selected state: there is no border here to thicken,
  // and it sits a pixel off the glyphs so it never crowds them.
  const ring: CSSProperties =
    selected === true || editing
      ? { outline: '1px solid var(--focus)', outlineOffset: 2, borderRadius: 2 }
      : {};

  const resizer = <NodeResize node={text} selected={selected === true} />;
  const root = cx('relative h-full w-full', `karta-lod-${lod}`, editing && 'nodrag');

  // Type is the whole substance of this node, so its editor rides along at
  // every level of detail — as the shape's colour editor does — and never on a
  // locked one, which has nothing a control here could change.
  const toolbar = selected === true && !text.locked ? <TextToolbar text={text} /> : null;

  // Below 0.25 no text is legible, so the node keeps its place as a bar in its
  // own ink — the same trade every other node makes at that zoom (spec 7.3).
  if (lod === 'block') {
    return (
      <>
        {resizer}
        {toolbar}
        <div className={root} style={ring}>
          <div className="absolute inset-0 rounded-[2px] opacity-30" style={{ background: ink }} aria-hidden />
          <NodeHandles connectable={!text.locked} />
        </div>
      </>
    );
  }

  return (
    <>
      {resizer}
      {toolbar}
      {/* Ink on the canvas casts no shadow while it is dragged: there is no card to lift. */}
      <div className={cx(root, 'group')} style={ring} onDoubleClick={onDoubleClick}>
        {/* Measured, and so never height-constrained: this is what the box fits itself to. */}
        <div
          ref={box}
          className={cx(
            'absolute left-0 right-0 top-0 whitespace-pre-wrap break-words',
            editing && 'invisible',
          )}
          style={{ ...type, minHeight: text.fontSize * LEADING + 2 * PAD }}
        >
          {body}
        </div>

        {editing && (
          <textarea
            ref={input}
            className="nodrag nowheel absolute left-0 right-0 top-0 resize-none overflow-hidden border-0 bg-transparent outline-none"
            style={type}
            value={draft}
            // Exactly what `api/src/domain/validate.ts` accepts, from the same
            // constant — the field cannot type a board that cannot be saved.
            maxLength={MAX_NODE_TEXT}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        )}

        {/* An empty text node is still findable: the hint shows on hover, and
            stays up while the node is selected. */}
        {!editing && body.length === 0 && (
          <div
            className={cx(
              'pointer-events-none absolute left-0 right-0 top-0 truncate italic',
              selected === true ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            style={{ ...type, color: 'var(--ink-muted)' }}
          >
            {text.locked ? 'Empty text' : 'Double-click to write'}
          </div>
        )}

        <NodeHandles connectable={!text.locked} />
      </div>
    </>
  );
}

export default memo(TextNodeView);
