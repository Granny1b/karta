import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** One sentence, sentence case, no full stop unless it is a sentence (8.4). */
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * The one line in the middle of an empty surface (spec 8.4), with room for the
 * sentence that explains it and the button that ends it. The title carries the
 * full ink and the hint the muted ink, so the pair reads as one statement and
 * one aside rather than two greys.
 */
export default function EmptyState({ title, hint, action, className = '' }: EmptyStateProps): JSX.Element {
  return (
    <div className={`karta-emptystate ${className}`.trimEnd()}>
      <p className="karta-emptystate-title">{title}</p>
      {hint ? <p className="karta-emptystate-hint">{hint}</p> : null}
      {action ? <div className="karta-emptystate-action">{action}</div> : null}
    </div>
  );
}
