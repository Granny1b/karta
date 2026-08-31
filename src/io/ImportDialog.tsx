import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileUp, X } from 'lucide-react';
import type { BoardDoc } from '@/domain/board';
import { api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { applyImport, type ImportMode, type ImportSummary } from '@/io/importer';
import { validateImport, type KartaImport } from '@/io/schema';

type Parsed =
  | { state: 'empty' }
  | { state: 'unreadable'; message: string }
  | { state: 'invalid'; errors: string[]; warnings: string[] }
  | { state: 'valid'; value: KartaImport; warnings: string[] };

const MAX_LISTED = 8;

function parse(text: string): Parsed {
  const raw = text.trim();
  if (raw.length === 0) return { state: 'empty' };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected character';
    return { state: 'unreadable', message };
  }

  const result = validateImport(value);
  return result.ok
    ? { state: 'valid', value: result.value, warnings: result.warnings }
    : { state: 'invalid', errors: result.errors, warnings: result.warnings };
}

function summaryLine(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.cards > 0) parts.push(`${summary.cards} card${summary.cards === 1 ? '' : 's'}`);
  if (summary.notes > 0) parts.push(`${summary.notes} note${summary.notes === 1 ? '' : 's'}`);
  if (summary.edges > 0) parts.push(`${summary.edges} arrow${summary.edges === 1 ? '' : 's'}`);
  const head = parts.length > 0 ? parts.join(', ') : 'nothing new';

  const tail: string[] = [];
  if (summary.labelsCreated.length > 0) tail.push(`creates labels: ${summary.labelsCreated.join(', ')}`);
  if (summary.statusesCreated.length > 0)
    tail.push(`creates statuses: ${summary.statusesCreated.join(', ')}`);

  return tail.length > 0 ? `${head} — ${tail.join('; ')}` : head;
}

/**
 * Paste JSON, see exactly what it will do, then do it. Validation runs on every
 * keystroke so the error list is never stale, and a *replace* import takes a
 * snapshot first — it is the only destructive thing in the product (spec 7.5).
 */
export default function ImportDialog(): JSX.Element {
  const doc = useBoardStore((s) => s.doc);
  const boardId = useBoardStore((s) => s.boardId);
  const userId = useBoardStore((s) => s.me?.userId ?? '');
  const mutate = useBoardStore((s) => s.mutate);
  const setDialog = useUiStore((s) => s.setDialog);
  const toast = useUiStore((s) => s.toast);

  const [text, setText] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setDialog(null), [setDialog]);

  useEffect(() => {
    textarea.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const parsed = useMemo(() => parse(text), [text]);

  // The preview is a real import against the live document, thrown away. It is
  // the only way to promise exactly what the button will do.
  const preview = useMemo<ImportSummary | null>(() => {
    if (!doc || parsed.state !== 'valid') return null;
    return applyImport(doc, parsed.value, userId, mode).summary;
  }, [doc, parsed, userId, mode]);

  const warnings = useMemo(() => {
    const fromParse = parsed.state === 'valid' || parsed.state === 'invalid' ? parsed.warnings : [];
    return [...fromParse, ...(preview?.warnings ?? [])];
  }, [parsed, preview]);

  const loadFile = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      setText(await file.text());
      textarea.current?.focus();
    } catch {
      toast('That file could not be read.', 'error');
    }
  };

  const run = async (): Promise<void> => {
    const current: BoardDoc | null = useBoardStore.getState().doc;
    if (!current || !boardId || parsed.state !== 'valid' || busy) return;

    setBusy(true);
    try {
      if (mode === 'replace') {
        try {
          await api.snapshot(boardId);
        } catch {
          toast('Could not take a snapshot first — importing anyway.', 'warn');
        }
      }

      const outcome = applyImport(current, parsed.value, userId, mode);
      mutate('Import JSON', (d) => {
        d.title = outcome.doc.title;
        d.icon = outcome.doc.icon;
        d.statuses = outcome.doc.statuses;
        d.labels = outcome.doc.labels;
        d.nodes = outcome.doc.nodes;
        d.edges = outcome.doc.edges;
      });

      toast(`Imported ${summaryLine(outcome.summary)}.`);
      for (const warning of outcome.summary.warnings.slice(0, 3)) toast(warning, 'warn');
      if (outcome.summary.warnings.length > 3) {
        toast(`${outcome.summary.warnings.length - 3} more arrows could not be matched.`, 'warn');
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  const ready = parsed.state === 'valid' && doc !== null && !busy;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import JSON"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-[760px] flex-col rounded border border-line bg-raised text-ink">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-condensed text-[17px] font-semibold">Import JSON</h2>
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
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">
              Paste cards from an AI, or load a file you exported earlier.
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex shrink-0 items-center gap-1.5 rounded border border-line px-2 py-1 text-[13px] hover:bg-sunken"
            >
              <FileUp size={13} />
              Load file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void loadFile(e.currentTarget)}
            />
          </div>

          <textarea
            ref={textarea}
            value={text}
            spellCheck={false}
            aria-label="JSON to import"
            placeholder={'{\n  "kartaVersion": 1,\n  "cards": [{ "title": "First card" }]\n}'}
            onChange={(e) => setText(e.target.value)}
            className="h-[240px] w-full resize-y rounded border border-line bg-canvas px-2 py-2 font-mono text-[12.5px] leading-[1.5] text-ink outline-none placeholder:text-ink-muted focus:border-[var(--focus)]"
          />

          {parsed.state === 'unreadable' ? (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] text-[var(--temper-copper)]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              That is not valid JSON — {parsed.message}
            </p>
          ) : null}

          {parsed.state === 'invalid' ? (
            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-[var(--temper-copper)]">
              {parsed.errors.slice(0, MAX_LISTED).map((error) => (
                <li key={error} className="flex items-start gap-1.5">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span className="font-mono text-[12.5px]">{error}</span>
                </li>
              ))}
              {parsed.errors.length > MAX_LISTED ? (
                <li className="pl-[22px] text-ink-muted">
                  …and {parsed.errors.length - MAX_LISTED} more.
                </li>
              ) : null}
            </ul>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-muted">
              {warnings.slice(0, MAX_LISTED).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {warnings.length > MAX_LISTED ? (
                <li>…and {warnings.length - MAX_LISTED} more notes.</li>
              ) : null}
            </ul>
          ) : null}

          <fieldset className="mt-3 flex flex-wrap items-center gap-4 border-t border-line pt-3">
            <legend className="sr-only">How to import</legend>
            {(['merge', 'replace'] as const).map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === option}
                  onChange={() => setMode(option)}
                  className="h-3.5 w-3.5 accent-[var(--focus)]"
                />
                {option === 'merge' ? 'Add to this board' : 'Replace everything on this board'}
              </label>
            ))}
            {mode === 'replace' ? (
              <span className="text-[12px] text-ink-muted">
                A snapshot is taken first, so this can be undone.
              </span>
            ) : null}
          </fieldset>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
            {doc === null
              ? 'Open a board first.'
              : preview
                ? summaryLine(preview)
                : 'Nothing to import yet.'}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded border border-line px-2 py-1 text-[13px] hover:bg-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={() => void run()}
              className="flex items-center gap-1.5 rounded border border-[var(--focus)] bg-[var(--focus)] px-3 py-1 text-[13px] text-white disabled:opacity-40"
            >
              <Check size={14} />
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
