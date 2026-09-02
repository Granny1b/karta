import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import type { SnapshotRef } from '@/domain/board';
import { api } from '@/lib/api';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { useBoardStore } from '@/state/boardStore';
import { useUiStore } from '@/state/uiStore';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import EmptyState from '@/components/EmptyState';

/**
 * Restore points (spec 7.5). One is taken on the first open of a board each day,
 * before an extract and before a restore — including the restore started here,
 * so undoing a restore is itself a restore.
 */
export default function SnapshotsDialog(): JSX.Element {
  const boardId = useBoardStore((s) => s.boardId);
  const replaceDoc = useBoardStore((s) => s.replaceDoc);
  const save = useBoardStore((s) => s.save);
  const setDialog = useUiStore((s) => s.setDialog);
  const toast = useUiStore((s) => s.toast);

  const [snapshots, setSnapshots] = useState<SnapshotRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!boardId) {
      // No board, no history — and the dialog still has to be closable, so it
      // lands on the empty state rather than sitting at "Loading…" forever.
      setSnapshots([]);
      setError('Open a board to see its restore points.');
      return;
    }
    setError(null);
    try {
      const list = await api.listSnapshots(boardId);
      setSnapshots([...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    } catch (err) {
      setSnapshots([]);
      setError(err instanceof Error && err.message ? err.message : 'Could not load the restore points');
    }
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  const takeNow = async (): Promise<void> => {
    if (!boardId || busy) return;
    setBusy(true);
    try {
      await save();
      await api.snapshot(boardId);
      await load();
      toast('Restore point taken.');
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Could not take a restore point', 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string): Promise<void> => {
    if (!boardId || busy) return;
    setBusy(true);
    setConfirming(null);
    try {
      // Whatever is on screen becomes a restore point of its own first.
      await save();
      try {
        await api.snapshot(boardId);
      } catch {
        toast('Could not save the current state first — restoring anyway.', 'warn');
      }
      const { doc, etag } = await api.restore(boardId, name);
      replaceDoc(doc, etag, 'Restore a snapshot');
      toast(`Restored the version from ${formatDateTime(doc.updatedAt)}.`);
      setDialog(null);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Could not restore that version', 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Restore points"
      width="md"
      onClose={() => setDialog(null)}
      footer={
        <>
          <Button size="sm" disabled={busy || !boardId} onClick={() => void takeNow()}>
            <History size={14} />
            Take one now
          </Button>
          <Button size="sm" variant="primary" onClick={() => setDialog(null)}>
            Done
          </Button>
        </>
      }
    >
      {error ? <p className="mb-3 text-caption text-danger">{error}</p> : null}

      {snapshots === null ? (
        <p className="py-6 text-center text-ui text-ink-muted">Loading…</p>
      ) : snapshots.length === 0 ? (
        <EmptyState
          title="No restore points yet"
          hint="One is taken automatically the first time you open this board each day, and before anything destructive."
        />
      ) : (
        <ul className="flex flex-col">
          {snapshots.map((snapshot) => (
            <li key={snapshot.name} className="flex flex-col gap-2 border-b border-line py-2 last:border-b-0">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-ink">{formatDateTime(snapshot.createdAt)}</span>
                  <span className="block text-control text-ink-muted">
                    {formatRelative(snapshot.createdAt)} · {formatBytes(snapshot.bytes)}
                  </span>
                </span>
                {confirming === snapshot.name ? null : (
                  <Button size="sm" disabled={busy} onClick={() => setConfirming(snapshot.name)}>
                    Restore
                  </Button>
                )}
              </div>

              {confirming === snapshot.name ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-sunken px-2 py-2 text-caption text-ink-muted">
                  <span className="min-w-0 flex-1">
                    Replace the board with this version? The current state is saved as a restore point first.
                  </span>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void restore(snapshot.name)}>
                    Restore this
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
