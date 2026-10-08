import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/** Renders long lists in pages; resets when `resetKey` (e.g. a filter) changes. */
export function usePaged(pageSize = 300, resetKey?: unknown) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => {
    setLimit(pageSize);
  }, [resetKey, pageSize]);
  return { limit, more: () => setLimit((l) => l + pageSize), pageSize };
}

export function ShowMore({ shown, total, onMore, pageSize = 300 }: { shown: number; total: number | null; onMore: () => void; pageSize?: number }) {
  if (total != null && shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3 text-xs text-muted">
      {total != null ? `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}` : `Showing the first ${shown.toLocaleString()}`}
      <Button size="sm" onClick={onMore}>
        Show {total != null ? Math.min(pageSize, total - shown).toLocaleString() : pageSize.toLocaleString()} more
      </Button>
    </div>
  );
}
