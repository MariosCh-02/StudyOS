import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  /** Remembers the divider position per layout (stored locally on this PC). */
  storageKey: string;
  defaultRatio?: number;
  minPx?: number;
  /** Hides the left pane while keeping the right pane mounted (no editor remount). */
  collapsed?: boolean;
  className?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function readRatio(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(`studyos.split.${key}`));
    return Number.isFinite(v) && v > 0.05 && v < 0.95 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Two panes with a draggable (and keyboard-adjustable) divider. */
export function SplitPane({ left, right, storageKey, defaultRatio = 0.5, minPx = 280, collapsed = false, className }: SplitPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => readRatio(storageKey, defaultRatio));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(`studyos.split.${storageKey}`, String(ratio));
    } catch {
      // Not critical.
    }
  }, [ratio, storageKey]);

  const ratioAt = useCallback(
    (clientX: number) => {
      const rect = container.current!.getBoundingClientRect();
      const min = Math.min(0.45, minPx / rect.width);
      return clamp((clientX - rect.left) / rect.width, min, 1 - min);
    },
    [minPx],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };

  return (
    <div ref={container} className={clsx("flex h-full min-h-0 w-full", dragging && "cursor-col-resize select-none", className)}>
      <div className={clsx("min-w-0 overflow-hidden", collapsed && "hidden")} style={{ width: `${ratio * 100}%` }}>
        {collapsed ? null : left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={5}
        aria-valuemax={95}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => dragging && setRatio(ratioAt(e.clientX))}
        onPointerUp={() => setDragging(false)}
        onDoubleClick={() => setRatio(defaultRatio)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setRatio((r) => clamp(r - 0.02, 0.15, 0.85));
          if (e.key === "ArrowRight") setRatio((r) => clamp(r + 0.02, 0.15, 0.85));
        }}
        hidden={collapsed}
        className="group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-accent/60 focus-visible:bg-accent"
        title="Drag to resize · double-click to reset"
      >
        {/* Wider invisible hit area. */}
        <div className="absolute inset-y-0 -right-1.5 -left-1.5" />
      </div>
      {/* Overlay stops iframes/canvases from swallowing pointer events while dragging. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      <div className="min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
