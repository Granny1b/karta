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
  /** Where focus lands on open. Defaults to the first focusable in the panel. */
  initialFocus?: RefObject<HTMLElement | null>;
}

const WIDTH: Record<DialogWidth, string> = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[800px]',
};

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
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }, []);

  // Focus moves in on open and back to wherever it was on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (initialFocus?.current ?? first ?? panelRef.current)?.focus();
    return () => previous?.focus();
  }, [initialFocus]);

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
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`flex max-h-[86vh] w-full ${WIDTH[width]} flex-col rounded-[var(--radius)] border border-line bg-raised text-ink outline-none`}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-condensed text-[17px] font-semibold">
            {title}
          </h2>
          <IconButton label="Close" size="sm" icon={<X size={16} />} onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>

        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}
