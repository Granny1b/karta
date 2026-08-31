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
import { useStoreApi, type NodeProps } from '@xyflow/react';
import { colorValue } from '@/lib/colors';
import { isEditableTarget } from '@/lib/keys';
import { cx } from '@/canvas/cx';
import { insideDialog } from '@/canvas/useCanvasShortcuts';
import NodeHandles from '@/canvas/nodes/NodeHandles';
import NodeResize from '@/canvas/nodes/NodeResize';
import { useLod } from '@/canvas/nodes/hooks';
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
   */
  const commit = useCallback(
    (value: string): void => {
      const fit = input.current?.scrollHeight ?? 0;
      setDraft(null);
      if (value === text.text) return;
      const patch: Record<string, unknown> = { text: value };
      if (fit > 0 && fit !== text.size.h) patch.size = { w: text.size.w, h: fit };
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

  // Below 0.25 no text is legible, so the node keeps its place as a bar in its
  // own ink — the same trade every other node makes at that zoom (spec 7.3).
  if (lod === 'block') {
    return (
      <>
        {resizer}
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
