import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { X } from 'lucide-react';
import IconButton from '@/components/IconButton';

export type DialogWidth = 'sm' | 'md' | 'lg';

export interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  width?: DialogWidth;
  /** Suppresses Escape and the backdrop click, for a dialog that must be answered. */
  dismissible?: boolean;
  /** Where focus lands on open. Defaults to the panel itself. */
  initialFocus?: RefObject<HTMLElement | null>;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The modal shell: a backdrop, one panel, a focus trap and Escape. Every dialog
 * in the shell is built on it, so they behave identically and none of them
 * animates in (8.3).
 */
export default function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 'md',
  dismissible = true,
  initialFocus,
}: DialogProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const focusables = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      // `offsetParent` lies about anything positioned `fixed`; boxes do not.
      (el) => el.getClientRects().length > 0 || el === document.activeElement,
    );
  }, []);

  /*
   * Focus moves onto the panel rather than onto the first control in it, which
   * is the close button: landing on Close reads as "the only thing here is a way
   * out", and it means a screen reader announces that button instead of the
   * title of the thing that just opened. Tab from there reaches the controls in
   * order. On close it goes back to whatever opened the dialog, unless that has
   * since left the document.
   */
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocus?.current ?? panelRef.current)?.focus();
    return () => {
      if (opener?.isConnected === true) opener.focus();
    };
  }, [initialFocus]);

  // Nothing behind the backdrop scrolls while it is up.
  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      // Nothing behind the backdrop should see this key, answered or not.
      e.stopPropagation();
      if (dismissible) onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    // The trap. Without it, Tab walks out onto the canvas behind the backdrop.
    const items = focusables();
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    const last = items.length - 1;

    if (e.shiftKey && index <= 0) {
      e.preventDefault();
      items[last]?.focus();
    } else if (!e.shiftKey && (index === last || index === -1)) {
      e.preventDefault();
      items[0]?.focus();
    }
    e.stopPropagation();
  };

  return (
    <div
      className="karta-modal-scrim"
      onMouseDown={(e) => {
        // Mouse down, not click: a selection dragged out of the body and
        // released over the backdrop must not count as dismissing the dialog.
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-width={width}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="karta-modal"
      >
        <header className="karta-modal-head">
          <h2 id={titleId} className="karta-modal-title">
            {title}
          </h2>
          <IconButton label="Close" size="sm" icon={<X size={16} />} onClick={onClose} />
        </header>

        <div className="karta-modal-body">{children}</div>

        {footer ? <footer className="karta-modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
