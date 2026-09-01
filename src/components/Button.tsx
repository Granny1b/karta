import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/*
 * A button is a 1 px border and a label. Every measurement it uses — height,
 * inline padding, radius, type size — is a step on a scale in `tokens.css`, and
 * the whole of it lives in the `.karta-btn` block in `styles/index.css`. What is
 * left here is which variant and which size, because those are the only two
 * decisions a caller gets to make.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'karta-btn--primary',
  default: 'karta-btn--default',
  ghost: 'karta-btn--ghost',
  danger: 'karta-btn--danger',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'karta-btn--sm',
  md: '',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={['karta-btn', VARIANT[variant], SIZE[size], className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
});

export default Button;
