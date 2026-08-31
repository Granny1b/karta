import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/*
 * A button is a 1 px border and a label. No shadow, no gradient, no lift on
 * hover — hover only changes the ink or the border (8.3).
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-[var(--focus)] bg-[var(--focus)] text-[var(--surface-raised)] hover:brightness-110 disabled:hover:brightness-100',
  default: 'border-line bg-raised text-ink hover:border-line-strong',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:text-ink',
  danger: 'border-line bg-raised text-[var(--temper-copper)] hover:border-[var(--temper-copper)]',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2 text-[13px]',
  md: 'h-8 gap-2 px-3 text-[14px]',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--radius)] border transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
});

export default Button;
