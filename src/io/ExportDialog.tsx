import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { AI_PROMPT_TEMPLATE, exportFull, exportPortable } from '@/io/exporter';

type Tab = 'portable' | 'full' | 'prompt';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'portable', label: 'Portable', hint: 'Names instead of ids — hand this back to an AI.' },
  { id: 'full', label: 'Full', hint: 'The whole board document, exactly as it is stored.' },
  { id: 'prompt', label: 'AI prompt', hint: 'Paste this into an AI, then paste its answer into Import.' },
];

function slug(title: string): string {
  const cleaned = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'board';
}

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Two exports and the prompt that produces an import. Everything is a
 * read-only box plus one button — no options, because there are none worth
 * having.
 */
export default function ExportDialog(): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const setDialog = useUiStore((s) => s.setDialog);
  const toast = useUiStore((s) => s.toast);

  const [tab, setTab] = useState<Tab>('portable');
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const close = useCallback(() => setDialog(null), [setDialog]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const content = useMemo(() => {
    if (tab === 'prompt') return AI_PROMPT_TEMPLATE;
    if (!doc) return '';
    return tab === 'portable' ? exportPortable(doc) : exportFull(doc);
  }, [doc, tab]);

  useEffect(() => {
    setCopied(false);
  }, [tab]);

  const copy = async (): Promise<void> => {
    if (content.length === 0) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
      return;
    } catch {
      // Clipboard permission refused, or an insecure origin.
    }
    const field = box.current;
    if (field) {
      field.focus();
      field.select();
      toast('Press Ctrl+C to copy — this browser blocked the clipboard.', 'warn');
    } else {
      toast('Could not copy to the clipboard.', 'error');
    }
  };

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-[760px] flex-col rounded border border-line bg-raised text-ink">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-condensed text-[17px] font-semibold">Export</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-ink-muted hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div role="tablist" aria-label="Export format" className="flex items-center gap-1">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={`rounded border px-2 py-1 text-[13px] ${
                  tab === entry.id
                    ? 'border-line-strong bg-sunken text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <p className="mt-2 text-[13px] text-ink-muted">{active.hint}</p>

          <textarea
            ref={box}
            readOnly
            spellCheck={false}
            value={doc === null && tab !== 'prompt' ? 'Open a board first.' : content}
            aria-label={`${active.label} export`}
            className="mt-2 h-[320px] w-full resize-y rounded border border-line bg-canvas px-2 py-2 font-mono text-[12.5px] leading-[1.5] text-ink outline-none focus:border-[var(--focus)]"
          />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
            {content.length > 0 ? `${content.length.toLocaleString('en-GB')} characters` : ''}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {tab !== 'prompt' && doc !== null ? (
              <button
                type="button"
                onClick={() => download(`${slug(doc.title)}-${tab}.json`, content)}
                className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[13px] hover:bg-sunken"
              >
                <Download size={13} />
                Download .json
              </button>
            ) : null}
            <button
              type="button"
              disabled={content.length === 0}
              onClick={() => void copy()}
              className="flex items-center gap-1.5 rounded border border-[var(--focus)] bg-[var(--focus)] px-3 py-1 text-[13px] text-white disabled:opacity-40"
            >
              {copied ? <Check size={14} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
