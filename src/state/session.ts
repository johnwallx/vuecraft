// Connection to the Rust document session. Every backend call runs one at a time,
// so each transaction is based on the latest accepted revision and responses
// cannot arrive out of order. A rejected call resyncs to the canonical state.
import { useCallback, useMemo, useRef, useState } from 'react';
import { api, type Op, type Snapshot } from '../bridge/api';

export interface Session {
  snapshot: Snapshot | null;
  /** Increments whenever the whole document is replaced (new/open). */
  generation: number;
  error: string | null;
  clearError: () => void;
  /** Shows a message in the banner (used for actions that cannot apply). */
  report: (message: string) => void;
  load: () => Promise<Snapshot | null>;
  commit: (label: string, ops: Op[]) => Promise<Snapshot | null>;
  undo: () => Promise<Snapshot | null>;
  redo: () => Promise<Snapshot | null>;
  newDocument: () => Promise<Snapshot | null>;
  open: (path: string) => Promise<Snapshot | null>;
  save: (path: string | null) => Promise<Snapshot | null>;
  exportSvg: (path: string) => Promise<boolean>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useSession(): Session {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const revision = useRef(0);

  const accept = useCallback((s: Snapshot) => {
    revision.current = s.revision;
    setSnapshot(s);
    return s;
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(task);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  const run = useCallback(
    (call: () => Promise<Snapshot>, replaces = false) =>
      enqueue(async () => {
        try {
          const s = accept(await call());
          if (replaces) setGeneration((g) => g + 1);
          return s;
        } catch (err) {
          setError(message(err));
          try {
            accept(await api.get());
          } catch {
            // Keep the last known state; the error is already shown.
          }
          return null;
        }
      }),
    [accept, enqueue],
  );

  const exportSvg = useCallback(
    (path: string) =>
      enqueue(async () => {
        try {
          await api.exportSvg(path);
          return true;
        } catch (err) {
          setError(message(err));
          return false;
        }
      }),
    [enqueue],
  );

  return useMemo(
    () => ({
      snapshot,
      generation,
      error,
      clearError: () => setError(null),
      report: (message: string) => setError(message),
      load: () => run(api.get, true),
      commit: (label: string, ops: Op[]) =>
        ops.length ? run(() => api.apply(revision.current, label, ops)) : Promise.resolve(null),
      undo: () => run(api.undo),
      redo: () => run(api.redo),
      newDocument: () => run(api.newDocument, true),
      open: (path: string) => run(() => api.open(path), true),
      save: (path: string | null) => run(() => api.save(path)),
      exportSvg,
    }),
    [snapshot, generation, error, run, exportSvg],
  );
}
