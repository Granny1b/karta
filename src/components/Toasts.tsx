import { X } from 'lucide-react';
import { useUiStore, type ToastKind } from '@/state/uiStore';

const ACCENT: Record<ToastKind, string> = {
  info: 'var(--line-strong)',
  warn: 'var(--temper-straw)',
  error: 'var(--temper-copper)',
};

/**
 * Transient messages, bottom left, out of the way of the canvas controls. The
 * store owns the timers; this only draws them.
 */
export default function Toasts(): JSX.Element | null {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex items-start gap-2 overflow-hidden rounded-[var(--radius)] border border-line bg-raised py-2 pl-0 pr-2 text-[13px] text-ink"
        >
          {/* The same 4 px bar the cards carry, in the tone of the message. */}
          <span
            aria-hidden
            className="w-1 self-stretch shrink-0"
            style={{ backgroundColor: ACCENT[toast.kind] }}
          />
          <p className="min-w-0 flex-1 py-0.5 pl-1">{toast.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.id)}
            className="mt-0.5 shrink-0 rounded p-0.5 text-ink-muted hover:text-ink"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
