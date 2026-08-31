import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ColorToken, HexColor } from '@/domain/board';
import { TEMPER_TOKENS, colorValue, isColorToken, isHexColor } from '@/lib/colors';

export type ColorValue = ColorToken | HexColor | null;

export interface ColorSwatchesProps {
  value: ColorValue;
  onChange(next: ColorValue): void;
  /** Statuses and labels only carry tokens — hide the hex picker for those. */
  tokensOnly?: boolean;
  disabled?: boolean;
}

const FALLBACK_HEX = '#64748b'; // --temper-slate, the uncoloured default

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
    <div className="flex flex-wrap items-center gap-1.5">
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
            className="grid h-6 w-6 place-items-center rounded border border-line disabled:opacity-50"
            style={{ backgroundColor: colorValue(token) }}
          >
            {active ? <Check size={13} strokeWidth={3} className="text-white" /> : null}
          </button>
        );
      })}

      {tokensOnly ? null : (
        <label
          className="relative grid h-6 w-6 place-items-center overflow-hidden rounded border border-line"
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
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          {customActive ? (
            <Check size={13} strokeWidth={3} className="pointer-events-none text-white" />
          ) : (
            <span className="pointer-events-none font-mono text-[10px] text-ink-muted">#</span>
          )}
        </label>
      )}

      {value !== null && (isColorToken(value) || isHexColor(value)) ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          title="Clear the colour"
          aria-label="Clear the colour"
          className="grid h-6 w-6 place-items-center rounded border border-line text-ink-muted hover:text-ink disabled:opacity-50"
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}
