import { X } from 'lucide-react';
import { useUiStore } from '@/state/uiStore';

/**
 * Transient messages along the bottom edge, centred: the status dock owns the
 * bottom-left corner and the zoom controls the bottom-right, so that is the one
 * place a stack is genuinely out of the way. The store owns the timers; this
 * only draws them, newest nearest the edge so the stack grows away from the
 * thing that just happened.
 *
 * The kind is written to the element as `data-kind` and the 4 px bar the cards
 * carry is coloured from it in CSS, so there is no colour lookup here and no
 * tone that exists in the markup but not in the stylesheet.
 */
export default function Toasts(): JSX.Element | null {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="karta-toast-stack">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-kind={toast.kind}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className="karta-toast"
        >
          <span aria-hidden className="karta-toast-bar" />
          <p className="karta-toast-text">{toast.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.id)}
            className="karta-toast-close"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
