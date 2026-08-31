import { useCallback, useEffect, useRef, useState } from 'react';

export interface Draft {
  value: string;
  setValue(next: string): void;
  /** Write the pending value through immediately (blur, unmount, submit). */
  flush(): void;
}

/**
 * A text field that edits the document without filling the undo stack with one
 * entry per keystroke: the value lives locally while typing and is committed
 * after a pause, on blur, and on unmount. A value that changes underneath us —
 * an undo, a merge from another client, a different card — replaces the draft.
 */
export function useDraft(external: string, commit: (next: string) => void, delayMs = 500): Draft {
  const [value, setValue] = useState(external);
  const valueRef = useRef(external);
  const externalRef = useRef(external);
  const commitRef = useRef(commit);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    commitRef.current = commit;
  });

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    cancelTimer();
    const next = valueRef.current;
    if (next === externalRef.current) return;
    externalRef.current = next;
    commitRef.current(next);
  }, [cancelTimer]);

  useEffect(() => {
    if (external === externalRef.current) return;
    externalRef.current = external;
    valueRef.current = external;
    cancelTimer();
    setValue(external);
  }, [external, cancelTimer]);

  const update = useCallback(
    (next: string) => {
      valueRef.current = next;
      setValue(next);
      cancelTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush();
      }, delayMs);
    },
    [cancelTimer, delayMs, flush],
  );

  useEffect(() => () => flush(), [flush]);

  return { value, setValue: update, flush };
}
