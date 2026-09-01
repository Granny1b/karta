/**
 * Images arrive by paste or by drag from Explorer, and both land at the cursor
 * (spec 7.3). The upload runs in the background; the node appears when the
 * bytes are safely in storage, so an interrupted upload never leaves a card
 * pointing at nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Id } from '@/domain/board';
import { useBoardStore } from '@/state/boardStore';
import { makeImageNode } from '@/state/factories';
import { useUiStore } from '@/state/uiStore';
import { processAndUploadImage } from '@/media/upload';

/** Structural shapes, so React synthetic events and native events both fit. */
export interface ClipboardLike {
  clipboardData: DataTransfer | null;
  preventDefault(): void;
}

export interface DragLike {
  dataTransfer: DataTransfer | null;
  preventDefault(): void;
  clientX: number;
  clientY: number;
}

export interface CanvasImageDrop {
  onPaste(event: ClipboardLike): void;
  onDrop(event: DragLike): void;
  onDragOver(event: DragLike): void;
  /**
   * Where the pointer was last seen, in screen coordinates, or the centre of
   * the window if it has not moved yet. A paste carries no coordinates of its
   * own, so this is what "at the cursor" means for every Ctrl+V — the canvas
   * pastes cards at the same spot this hook drops images.
   */
  pointerPosition(): { x: number; y: number };
  /** True while at least one upload is in flight. */
  uploading: boolean;
}

const GRID = 8; // the canvas snaps to 8 px (spec 7.3)
const CASCADE = 24; // a batch of images fans out instead of stacking

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files: File[] = [];
  for (const file of Array.from(data.files ?? [])) {
    if (isImage(file)) files.push(file);
  }
  if (files.length > 0) return files;

  // A screenshot on the clipboard is an item, not a file, in some browsers.
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isImage(file)) files.push(file);
  }
  return files;
}

function hasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  if (data.files && data.files.length > 0) return true;
  return Array.from(data.types ?? []).includes('Files');
}

function describe(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return 'Could not add that image.';
}

/**
 * @param boardId the board the images belong to; `null` disables the handlers
 * @param screenToFlow React Flow's `screenToFlowPosition`
 */
export function useCanvasImageDrop(
  boardId: Id | null,
  screenToFlow: (p: { x: number; y: number }) => { x: number; y: number },
): CanvasImageDrop {
  const [pending, setPending] = useState(0);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const mounted = useRef(true);

  // A paste has no coordinates of its own, so the last pointer position is what
  // "at the cursor" means for Ctrl+V.
  useEffect(() => {
    mounted.current = true;
    const onMove = (e: PointerEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      mounted.current = false;
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  const upload = useCallback(
    async (files: File[], screen: { x: number; y: number }): Promise<void> => {
      if (!boardId || files.length === 0) return;

      const origin = screenToFlow(screen);
      const toast = useUiStore.getState().toast;
      setPending((n) => n + files.length);
      toast(files.length === 1 ? 'Uploading image…' : `Uploading ${files.length} images…`);

      let added = 0;
      for (let index = 0; index < files.length; index += 1) {
        try {
          const ref = await processAndUploadImage(files[index], boardId);
          const store = useBoardStore.getState();
          if (store.boardId !== boardId) continue; // the board changed under us

          store.addMedia(ref);
          const node = makeImageNode({
            mediaId: ref.id,
            naturalSize: { w: ref.width, h: ref.height },
            userId: store.me?.userId ?? '',
          });
          const offset = index * CASCADE;
          node.position = {
            x: snap(origin.x - node.size.w / 2 + offset),
            y: snap(origin.y - node.size.h / 2 + offset),
          };
          store.addNode(node);
          added += 1;
        } catch (err) {
          toast(describe(err), 'error');
        } finally {
          if (mounted.current) setPending((n) => Math.max(0, n - 1));
        }
      }

      if (added > 0) toast(added === 1 ? 'Image added' : `${added} images added`);
    },
    [boardId, screenToFlow],
  );

  const centreOfWindow = (): { x: number; y: number } => ({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });

  const pointerPosition = useCallback(
    (): { x: number; y: number } => pointer.current ?? centreOfWindow(),
    [],
  );

  const onPaste = useCallback(
    (event: ClipboardLike): void => {
      const files = imageFilesFrom(event.clipboardData);
      // Nothing to upload. A pasted card is the canvas's business and it has
      // already had its go at the event by the time this runs.
      if (files.length === 0) return;

      event.preventDefault();
      if (!boardId) {
        useUiStore.getState().toast('Open a board before adding an image.', 'warn');
        return;
      }
      void upload(files, pointerPosition());
    },
    [boardId, pointerPosition, upload],
  );

  const onDrop = useCallback(
    (event: DragLike): void => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();

      const files = imageFilesFrom(event.dataTransfer);
      if (files.length === 0) {
        useUiStore.getState().toast('That file is not an image.', 'warn');
        return;
      }
      if (!boardId) {
        useUiStore.getState().toast('Open a board before adding an image.', 'warn');
        return;
      }
      void upload(files, { x: event.clientX, y: event.clientY });
    },
    [boardId, upload],
  );

  const onDragOver = useCallback((event: DragLike): void => {
    if (!hasFiles(event.dataTransfer)) return;
    // Without this the browser navigates away to the dropped file.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, []);

  /*
   * One object for as long as its parts hold still. The canvas builds four
   * callbacks on top of this one, and a fresh literal here would take a new
   * identity on every render of the surface — including the frames of a
   * marquee, where the selection count changes and nothing else does.
   */
  return useMemo<CanvasImageDrop>(
    () => ({ onPaste, onDrop, onDragOver, pointerPosition, uploading: pending > 0 }),
    [onDragOver, onDrop, onPaste, pending, pointerPosition],
  );
}
