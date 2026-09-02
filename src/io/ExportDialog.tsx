import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { AI_PROMPT_TEMPLATE, exportFull, exportPortable } from '@/io/exporter';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';

type Tab = 'portable' | 'full' | 'prompt';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'portable', label: 'Portable', hint: 'Names instead of ids — hand this back to an AI.' },
  { id: 'full', label: 'Full', hint: 'The whole board document, exactly as it is stored.' },
  { id: 'prompt', label: 'AI prompt', hint: 'Paste this into an AI, then paste its answer into Import.' },
];

function slug(title: string): string {
  const cleaned = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

  const close = (): void => setDialog(null);

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
    <Dialog
      title="Export"
      width="lg"
      onClose={close}
      footer={
        <>
          <p className="min-w-0 flex-1 truncate text-caption text-ink-muted">
            {content.length > 0 ? `${content.length.toLocaleString('en-GB')} characters` : ''}
          </p>
          {tab !== 'prompt' && doc !== null ? (
            <Button onClick={() => download(`${slug(doc.title)}-${tab}.json`, content)}>
              <Download size={14} />
              Download .json
            </Button>
          ) : null}
          <Button variant="primary" disabled={content.length === 0} onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </>
      }
    >
      <div role="tablist" aria-label="Export format" className="flex flex-wrap items-center gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className="karta-toggle"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <p className="karta-caption mt-2">{active.hint}</p>

      <textarea
        ref={box}
        readOnly
        spellCheck={false}
        value={doc === null && tab !== 'prompt' ? 'Open a board first.' : content}
        aria-label={`${active.label} export`}
        className="karta-field karta-field--mono mt-2 h-[320px] bg-canvas"
      />
    </Dialog>
  );
}
