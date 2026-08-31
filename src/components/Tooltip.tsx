import type { ReactNode } from 'react';

export interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * A hint on hover or keyboard focus. CSS only — no timers, no portal, and no
 * animation; it is either there or it is not.
 *
 * The label is presentational: whatever it wraps still needs its own accessible
 * name (`IconButton` has one).
 */
export default function Tooltip({ label, children, side = 'bottom', className = '' }: TooltipProps): JSX.Element {
  const place = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  return (
    <span className={`group/tooltip relative inline-flex ${className}`}>
      {children}
      <span
        aria-hidden
        className={`pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[30ch] -translate-x-1/2 rounded-[var(--radius)] border border-line bg-raised px-1.5 py-0.5 text-[12px] text-ink-muted group-hover/tooltip:block group-focus-within/tooltip:block ${place}`}
      >
        {label}
      </span>
    </span>
  );
}
