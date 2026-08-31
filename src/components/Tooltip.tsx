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
 * The pointer waits a beat before it appears and the keyboard does not, which
 * is the whole reason this is a class rather than a `:hover` utility: a hint
 * that only answers the mouse is invisible to anyone driving with Tab.
 *
 * The label is presentational: whatever it wraps still needs its own accessible
 * name (`IconButton` has one).
 */
export default function Tooltip({ label, children, side = 'bottom', className = '' }: TooltipProps): JSX.Element {
  return (
    <span className={`karta-tip ${className}`.trimEnd()}>
      {children}
      <span aria-hidden className="karta-tip-bubble" data-side={side}>
        {label}
      </span>
    </span>
  );
}
