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
 * label layer, counter-scaled and set above the line so it never covers the
 * thing it is editing.
 *
 * The semantic is the only choice on it that changes what the board *means*,
 * so it gets the full width and says out loud what the chosen one claims —
 * four arrow types are a vocabulary, and a vocabulary has to be taught.
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

  const semantic = SEMANTICS.find((item) => item.value === edge.semantic) ?? SEMANTICS[0];

  return (
    <div className="karta-edge-toolbar nodrag nopan nowheel" role="group" aria-label="Arrow">
      <div className="karta-toolbar-seg">
        {SEMANTICS.map((item) => (
          <button
            key={item.value}
            type="button"
            title={item.hint}
            aria-pressed={edge.semantic === item.value}
            className={cx('karta-tool-btn', edge.semantic === item.value && 'is-on')}
            onClick={() => updateEdge(edge.id, { semantic: item.value })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="karta-toolbar-hint">{semantic.hint}</p>

      <hr className="karta-toolbar-rule" />

      <div className="karta-toolbar-row">
        <span className="karta-toolbar-label" id={`route-${edge.id}`}>
          Route
        </span>
        <div className="karta-toolbar-seg" role="group" aria-labelledby={`route-${edge.id}`}>
          {ROUTINGS.map(({ value, label: name, Icon }) => (
            <button
              key={value}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={edge.routing === value}
              className={cx('karta-tool-btn karta-tool-icon', edge.routing === value && 'is-on')}
              onClick={() => updateEdge(edge.id, { routing: value })}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>

      <div className="karta-toolbar-row">
        <span className="karta-toolbar-label" id={`colour-${edge.id}`}>
          Colour
        </span>
        <div className="karta-swatch-row" role="group" aria-labelledby={`colour-${edge.id}`}>
          <button
            type="button"
            title={`Semantic colour — ${semantic.label.toLowerCase()}`}
            aria-label="Semantic colour"
            aria-pressed={edge.color === null}
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
              aria-pressed={edge.color === token}
              className={cx('karta-swatch', edge.color === token && 'is-on')}
              style={{ background: colorValue(token) }}
              onClick={() => setColor(token)}
            />
          ))}
        </div>
      </div>

      <hr className="karta-toolbar-rule" />

      <div className="karta-toolbar-row">
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
