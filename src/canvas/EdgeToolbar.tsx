import { useEffect, useState } from 'react';
import { CornerDownRight, Minus, Spline, Trash2 } from 'lucide-react';
import type { ColorToken, Edge, EdgeRouting, EdgeSemantic } from '@/domain/board';
import { TEMPER_TOKENS, colorValue, edgeColor } from '@/lib/colors';
import { useBoardStore } from '@/state/boardStore';
import { cx } from '@/canvas/cx';

const SEMANTICS: ReadonlyArray<{ value: EdgeSemantic; label: string; hint: string }> = [
  { value: 'relates', label: 'Relates', hint: 'These belong together' },
  { value: 'depends', label: 'Depends', hint: 'Target needs source first' },
  { value: 'blocks', label: 'Blocks', hint: 'Source is stopping target' },
  { value: 'derives', label: 'Derives', hint: 'Target came out of source' },
];

const ROUTINGS: ReadonlyArray<{ value: EdgeRouting; label: string; Icon: typeof Spline }> = [
  { value: 'bezier', label: 'Curved', Icon: Spline },
  { value: 'smoothstep', label: 'Stepped', Icon: CornerDownRight },
  { value: 'straight', label: 'Straight', Icon: Minus },
];

/**
 * The floating editor for a selected arrow (spec 5.3). It lives in the edge
 * label layer, counter-scaled so it stays the same size at any zoom.
 */
export default function EdgeToolbar({ edge }: { edge: Edge }): JSX.Element {
  const updateEdge = useBoardStore((s) => s.updateEdge);
  const removeEdges = useBoardStore((s) => s.removeEdges);
  const [label, setLabel] = useState(edge.label ?? '');

  useEffect(() => {
    setLabel(edge.label ?? '');
  }, [edge.id, edge.label]);

  const commitLabel = (): void => {
    const next = label.trim();
    const value = next.length > 0 ? next : null;
    if (value !== edge.label) updateEdge(edge.id, { label: value });
  };

  const setColor = (color: ColorToken | null): void => {
    updateEdge(edge.id, { color });
  };

  return (
    <div className="karta-edge-toolbar nodrag nopan nowheel" role="group" aria-label="Arrow">
      <div className="flex gap-0.5">
        {SEMANTICS.map((item) => (
          <button
            key={item.value}
            type="button"
            title={item.hint}
            className={cx('karta-tool-btn', edge.semantic === item.value && 'is-on')}
            onClick={() => updateEdge(edge.id, { semantic: item.value })}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <div className="flex gap-0.5">
          {ROUTINGS.map(({ value, label: name, Icon }) => (
            <button
              key={value}
              type="button"
              title={name}
              aria-label={name}
              className={cx('karta-tool-btn karta-tool-icon', edge.routing === value && 'is-on')}
              onClick={() => updateEdge(edge.id, { routing: value })}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Semantic colour"
            aria-label="Semantic colour"
            className={cx('karta-swatch', edge.color === null && 'is-on')}
            style={{ background: edgeColor(edge.semantic, null) }}
            onClick={() => setColor(null)}
          />
          {TEMPER_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              title={token}
              aria-label={token}
              className={cx('karta-swatch', edge.color === token && 'is-on')}
              style={{ background: colorValue(token) }}
              onClick={() => setColor(token)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <input
          className="karta-input"
          value={label}
          placeholder="Label"
          aria-label="Arrow label"
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitLabel();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setLabel(edge.label ?? '');
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          title="Delete arrow"
          aria-label="Delete arrow"
          className="karta-tool-btn karta-tool-icon karta-danger"
          onClick={() => removeEdges([edge.id])}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
