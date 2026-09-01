import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: the button carries no text, so this is its whole accessible name. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
}

/**
 * A square button holding one lucide icon. The label is both title and
 * aria-label, and `aria-pressed` is what the on state is drawn from — the
 * styling and the semantics cannot drift apart because they are the same
 * attribute.
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active = false, size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      className={['karta-icon-btn', size === 'sm' ? 'karta-icon-btn--sm' : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon}
    </button>
  );
});

export default IconButton;
