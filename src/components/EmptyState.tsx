import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** One sentence, sentence case, no full stop unless it is a sentence (8.4). */
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

/** The one line in the middle of an empty surface (spec 8.4). */
export default function EmptyState({ title, hint, action, className = '' }: EmptyStateProps): JSX.Element {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-6 py-10 text-center ${className}`}>
      <p className="text-[15px] text-ink-muted">{title}</p>
      {hint ? <p className="max-w-[46ch] text-[13px] text-ink-muted">{hint}</p> : null}
      {action}
    </div>
  );
}
