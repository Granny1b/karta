import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eye, ImageOff, Pencil, Trash2, X } from 'lucide-react';
import { isCardNode, type BoardDoc, type CardNode, type ColorToken, type Id, type Iso } from '@/domain/board';
import { formatDateTime } from '@/lib/format';
import { colorValue } from '@/lib/colors';
import { makeLabel, nextCardRank } from '@/state/factories';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import { cardNodes } from '@/state/selectors';
import { useMediaUrl } from '@/media/mediaUrl';
import Checklist from '@/card/Checklist';
import ColorSwatches, { type ColorValue } from '@/card/ColorSwatches';
import LabelPicker from '@/card/LabelPicker';
import Markdown from '@/card/Markdown';
import { useDraft } from '@/card/useDraft';

/**
 * The card editor: a 380 px right-hand panel that slides in over the canvas
 * (spec 8.3). Every field writes through `updateNode` with its own undo label;
 * text fields commit on a pause rather than on every keystroke.
 */
export default function CardEditorPanel(): JSX.Element | null {
  const editorNodeId = useUiStore((s) => s.editorNodeId);
  const openEditor = useUiStore((s) => s.openEditor);
  const doc = useBoardStore((s) => s.doc);

  const card = useMemo<CardNode | null>(() => {
    if (!doc || editorNodeId === null) return null;
    const node = doc.nodes.find((n) => n.id === editorNodeId);
    return node && isCardNode(node) ? node : null;
  }, [doc, editorNodeId]);

  // Escape closes the panel even when focus sits out on the canvas (spec 9).
  useEffect(() => {
    if (card === null) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') openEditor(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [card, openEditor]);

  if (!doc || card === null) return null;
  return <Editor key={card.id} card={card} doc={doc} onClose={() => openEditor(null)} />;
}

function Editor({ card, doc, onClose }: { card: CardNode; doc: BoardDoc; onClose(): void }): JSX.Element {
  const updateNode = useBoardStore((s) => s.updateNode);
  const removeNodes = useBoardStore((s) => s.removeNodes);
  const mutate = useBoardStore((s) => s.mutate);
  const mediaUrl = useMediaUrl();

  const [shown, setShown] = useState(false);
  const [preview, setPreview] = useState(() => card.body.trim().length > 0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const title = useDraft(card.title, (value) => updateNode(card.id, { title: value }, 'Edit title'));
  const body = useDraft(card.body, (value) => updateNode(card.id, { body: value }, 'Edit body'), 700);

  const statuses = useMemo(() => [...doc.statuses].sort((a, b) => a.order - b.order), [doc.statuses]);
  const cover = card.coverMediaId ? (doc.media.find((m) => m.id === card.coverMediaId) ?? null) : null;

  const setStatus = (statusId: Id | null): void => {
    if (statusId === card.statusId) return;
    // A new column means a new place in that column's order (spec 7.4).
    const rank = nextCardRank(
      cardNodes(doc).filter((c) => c.id !== card.id),
      statusId,
    );
    updateNode(card.id, { statusId, rank }, 'Change status');
  };

  const setColor = (next: ColorValue): void => {
    updateNode(card.id, { color: next }, 'Change colour');
  };

  const toggleLabel = (labelId: Id): void => {
    const next = card.labelIds.includes(labelId)
      ? card.labelIds.filter((id) => id !== labelId)
      : [...card.labelIds, labelId];
    updateNode(card.id, { labelIds: next }, 'Change labels');
  };

  const createLabel = (name: string, color: ColorToken): void => {
    const label = makeLabel({ name, color });
    mutate('Add label', (d) => {
      d.labels.push(label);
      const node = d.nodes.find((n) => n.id === card.id);
      if (node && node.kind === 'card') node.labelIds.push(label.id);
    });
  };

  const setCover = (mediaId: Id | null): void => {
    updateNode(card.id, { coverMediaId: mediaId }, mediaId === null ? 'Remove cover' : 'Set cover');
  };

  const deleteCard = (): void => {
    removeNodes([card.id]);
    onClose();
  };

  return (
    <aside
      aria-label="Card editor"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
      }}
      className={`fixed bottom-0 right-0 top-12 z-30 flex w-[380px] max-w-full flex-col border-l border-line bg-raised text-ink transition-transform duration-150 ${
        shown ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <span
          className="mt-0.5 h-6 w-1 shrink-0 rounded-sm"
          style={{ backgroundColor: colorValue(card.color) }}
          aria-hidden
        />
        <input
          value={title.value}
          onChange={(e) => title.setValue(e.target.value)}
          onBlur={title.flush}
          placeholder="Card title"
          aria-label="Card title"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-condensed text-[18px] font-semibold outline-none placeholder:font-sans placeholder:font-normal placeholder:text-ink-muted focus:border-line"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the editor"
          className="rounded p-1 text-ink-muted hover:text-ink"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {cover ? (
          <img
            src={mediaUrl(cover.thumbPath) ?? undefined}
            alt=""
            className="mb-3 h-32 w-full rounded border border-line object-cover"
          />
        ) : null}

        <Field
          label="Notes"
          action={
            <button
              type="button"
              onClick={() => {
                body.flush();
                setPreview((p) => !p);
              }}
              className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[12px] text-ink-muted hover:text-ink"
            >
              {preview ? <Pencil size={12} /> : <Eye size={12} />}
              {preview ? 'Edit' : 'Preview'}
            </button>
          }
        >
          {preview ? (
            body.value.trim().length > 0 ? (
              <Markdown className="max-w-[68ch] text-[15px] leading-[1.5]">{body.value}</Markdown>
            ) : (
              <p className="text-[14px] text-ink-muted">Nothing written yet.</p>
            )
          ) : (
            <textarea
              value={body.value}
              onChange={(e) => body.setValue(e.target.value)}
              onBlur={body.flush}
              rows={8}
              placeholder="Markdown is supported"
              aria-label="Card notes"
              className="w-full max-w-[68ch] resize-y rounded border border-line bg-raised px-2 py-1.5 text-[15px] leading-[1.5] text-ink outline-none placeholder:text-ink-muted focus:border-[var(--focus)]"
            />
          )}
        </Field>

        <Field label="Checklist">
          <Checklist
            items={card.checklist}
            onChange={(next, label) => updateNode(card.id, { checklist: next }, label)}
          />
        </Field>

        <Field label="Labels">
          <LabelPicker
            labels={doc.labels}
            selectedIds={card.labelIds}
            onToggle={toggleLabel}
            onCreate={createLabel}
          />
        </Field>

        <Field label="Colour">
          <ColorSwatches value={card.color} onChange={setColor} />
        </Field>

        <Field label="Status">
          <select
            value={card.statusId ?? ''}
            onChange={(e) => setStatus(e.target.value === '' ? null : e.target.value)}
            className="w-full rounded border border-line bg-raised px-2 py-1 text-[14px] text-ink outline-none focus:border-[var(--focus)]"
          >
            <option value="">No status</option>
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due date">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateInputValue(card.dueDate)}
              onChange={(e) => updateNode(card.id, { dueDate: isoFromDateInput(e.target.value) }, 'Change due date')}
              className="rounded border border-line bg-raised px-2 py-1 text-[14px] text-ink outline-none focus:border-[var(--focus)]"
            />
            {card.dueDate ? (
              <button
                type="button"
                onClick={() => updateNode(card.id, { dueDate: null }, 'Clear due date')}
                className="text-[13px] text-ink-muted hover:text-ink"
              >
                Clear
              </button>
            ) : null}
          </div>
        </Field>

        <Field label="Cover image">
          {doc.media.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[13px] text-ink-muted">
              <ImageOff size={14} />
              No images on this board yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCover(null)}
                aria-pressed={card.coverMediaId === null}
                className={`h-12 w-16 rounded border text-[12px] text-ink-muted ${
                  card.coverMediaId === null ? 'border-line-strong text-ink' : 'border-line hover:text-ink'
                }`}
              >
                None
              </button>
              {doc.media.map((media) => {
                const url = mediaUrl(media.thumbPath);
                const active = card.coverMediaId === media.id;
                return (
                  <button
                    key={media.id}
                    type="button"
                    onClick={() => setCover(active ? null : media.id)}
                    aria-pressed={active}
                    aria-label="Use as cover"
                    className={`h-12 w-16 overflow-hidden rounded border ${
                      active ? 'border-line-strong' : 'border-line'
                    }`}
                  >
                    {url ? (
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center bg-sunken text-[11px] text-ink-muted">
                        …
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
        <div className="min-w-0 font-mono text-[11px] leading-tight text-ink-muted">
          <div className="truncate">Created {formatDateTime(card.createdAt)}</div>
          <div className="truncate">Updated {formatDateTime(card.updatedAt)}</div>
        </div>
        {confirmDelete ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={deleteCard}
              className="rounded border border-line px-2 py-1 text-[13px] text-[var(--temper-copper)] hover:bg-sunken"
            >
              Delete card
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-1 py-1 text-[13px] text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete card"
            className="shrink-0 rounded border border-line p-1.5 text-ink-muted hover:text-[var(--temper-copper)]"
          >
            <Trash2 size={15} />
          </button>
        )}
      </footer>
    </aside>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: JSX.Element;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[13px] text-ink-muted">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** `<input type="date">` speaks local calendar days; the document speaks ISO. */
function dateInputValue(iso: Iso | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function isoFromDateInput(value: string): Iso | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  // Local noon, so the calendar day survives every timezone offset.
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
