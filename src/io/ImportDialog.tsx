import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileUp } from 'lucide-react';
import type { BoardDoc } from '@/domain/board';
import { api } from '@/lib/api';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { applyImport, type ImportMode, type ImportSummary } from '@/io/importer';
import { validateImport, type KartaImport } from '@/io/schema';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';

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

/** `1 card`, `3 cards` — the plural is regular for everything counted here. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function summaryLine(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.cards > 0) parts.push(count(summary.cards, 'card'));
  if (summary.notes > 0) parts.push(count(summary.notes, 'note'));
  if (summary.texts > 0) parts.push(count(summary.texts, 'text'));
  if (summary.shapes > 0) parts.push(count(summary.shapes, 'shape'));
  if (summary.edges > 0) parts.push(count(summary.edges, 'arrow'));
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

  const close = (): void => setDialog(null);

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
    <Dialog
      title="Import JSON"
      width="lg"
      initialFocus={textarea}
      onClose={close}
      footer={
        <>
          <p className="min-w-0 flex-1 truncate text-caption text-ink-muted">
            {doc === null ? 'Open a board first.' : preview ? summaryLine(preview) : 'Nothing to import yet.'}
          </p>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={() => void run()}>
            <Check size={14} />
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="karta-caption">Paste cards from an AI, or load a file you exported earlier.</p>
        <Button size="sm" onClick={() => fileInput.current?.click()}>
          <FileUp size={13} />
          Load file
        </Button>
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
        className="karta-field karta-field--mono h-[240px] bg-canvas"
      />

      {parsed.state === 'unreadable' ? (
        <p className="mt-2 flex items-start gap-2 text-caption text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          That is not valid JSON — {parsed.message}
        </p>
      ) : null}

      {parsed.state === 'invalid' ? (
        <ul className="mt-2 flex flex-col gap-1 text-caption text-danger">
          {parsed.errors.slice(0, MAX_LISTED).map((error) => (
            <li key={error} className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="font-mono">{error}</span>
            </li>
          ))}
          {parsed.errors.length > MAX_LISTED ? (
            <li className="pl-6 text-ink-muted">…and {parsed.errors.length - MAX_LISTED} more.</li>
          ) : null}
        </ul>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-caption text-ink-muted">
          {warnings.slice(0, MAX_LISTED).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
          {warnings.length > MAX_LISTED ? <li>…and {warnings.length - MAX_LISTED} more notes.</li> : null}
        </ul>
      ) : null}

      <fieldset className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
        <legend className="sr-only">How to import</legend>
        {(['merge', 'replace'] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-caption text-ink">
            <input
              type="radio"
              name="import-mode"
              checked={mode === option}
              onChange={() => setMode(option)}
              className="karta-check"
            />
            {option === 'merge' ? 'Add to this board' : 'Replace everything on this board'}
          </label>
        ))}
        {mode === 'replace' ? (
          <span className="text-control text-ink-muted">A snapshot is taken first, so this can be undone.</span>
        ) : null}
      </fieldset>
    </Dialog>
  );
}
