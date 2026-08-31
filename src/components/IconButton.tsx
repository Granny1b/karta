import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: the button carries no text, so this is its whole accessible name. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
}

/** A square button holding one lucide icon. The label is both title and aria-label. */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active = false, size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-[var(--radius)] border transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${box} ${
        active ? 'border-line-strong bg-sunken text-ink' : 'border-transparent text-ink-muted hover:text-ink'
      } ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
});

export default IconButton;
