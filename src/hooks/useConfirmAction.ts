import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** State machine for "ask → confirm → run → refresh" flows such as deletions. */
export function useConfirmAction<T>(run: (target: T) => Promise<void>, onDone?: (target: T) => void) {
  const client = useQueryClient();
  const [target, setTarget] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (target == null) return;
    setBusy(true);
    setError(null);
    try {
      await run(target);
      const done = target;
      setTarget(null);
      onDone?.(done);
      await client.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    target,
    busy,
    error,
    ask: (t: T) => {
      setError(null);
      setTarget(t);
    },
    cancel: () => setTarget(null),
    confirm: () => void confirm(),
  };
}
