import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ColorToken, HexColor } from '@/domain/board';
import { TEMPER_TOKENS, colorValue, isColorToken, isHexColor } from '@/lib/colors';
import { cx } from '@/canvas/cx';

export type ColorValue = ColorToken | HexColor | null;

export interface ColorSwatchesProps {
  value: ColorValue;
  onChange(next: ColorValue): void;
  /** Statuses and labels only carry tokens — hide the hex picker for those. */
  tokensOnly?: boolean;
  disabled?: boolean;
}

/** `--temper-slate`, the uncoloured default, as the native picker's opening value. */
const FALLBACK_HEX = '#64748b';

/** Every cell in the row is this box: the seven colours, the picker, the clear. */
const CELL =
  'grid h-6 w-6 shrink-0 place-items-center rounded border transition-[outline-color,border-color,color] duration-fast ease-linear disabled:cursor-not-allowed disabled:opacity-45';

/** The chosen one wears the same ring a swatch on the canvas does. */
const ON = 'outline outline-1 outline-offset-1 outline-focus';

/**
 * The seven tempering colours (spec 8.1) plus a custom `#RRGGBB` picker that
 * writes into the same field. The native colour input fires continuously while
 * the user drags, so the picked value is only committed on blur — one undo
 * entry per choice rather than one per pixel.
 */
export default function ColorSwatches({ value, onChange, tokensOnly, disabled }: ColorSwatchesProps): JSX.Element {
  const [hex, setHex] = useState(() => (isHexColor(value) ? value.toLowerCase() : FALLBACK_HEX));
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (isHexColor(value)) setHex(value.toLowerCase());
  }, [value]);

  const customActive = isHexColor(value);

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Colour">
      {TEMPER_TOKENS.map((token) => {
        const active = value === token;
        return (
          <button
            key={token}
            type="button"
            disabled={disabled}
            title={token}
            aria-label={token}
            aria-pressed={active}
            onClick={() => onChange(active ? null : token)}
            className={cx(CELL, 'border-line', active && ON)}
            style={{ backgroundColor: colorValue(token) }}
          >
            {active ? <Check size={13} strokeWidth={3} className="text-white" /> : null}
          </button>
        );
      })}

      {tokensOnly ? null : (
        <label
          className={cx(CELL, 'relative overflow-hidden border-line', customActive && ON)}
          title="Custom colour"
          style={{ backgroundColor: customActive ? hex : 'var(--surface-sunken)' }}
        >
          <input
            type="color"
            disabled={disabled}
            value={hex}
            aria-label="Custom colour"
            onChange={(e) => {
              setHex(e.target.value);
              setPicking(true);
            }}
            onBlur={() => {
              if (!picking) return;
              setPicking(false);
              const next = hex.toLowerCase();
              if (isHexColor(next) && next !== value) onChange(next);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
          {customActive ? (
            <Check size={13} strokeWidth={3} className="pointer-events-none text-white" />
          ) : (
            <span className="pointer-events-none font-mono text-meta text-ink-muted">#</span>
          )}
        </label>
      )}

      {/* A label or a status always has a colour, so there is nothing to clear. */}
      {!tokensOnly && value !== null && (isColorToken(value) || isHexColor(value)) ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          title="Clear the colour"
          aria-label="Clear the colour"
          className={cx(CELL, 'border-line-control text-ink-muted hover:bg-hover hover:text-ink')}
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}
