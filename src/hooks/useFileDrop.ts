/**
 * Native file drag-and-drop.
 *
 * Tauri reports OS file drops for the whole window with real file paths (HTML5
 * drop events don't carry paths). Components mark an element as a drop zone;
 * a single window listener finds the zone under the pointer and routes the
 * dropped paths to it.
 */
import { useEffect, useId, useState } from "react";

type Zone = { onDrop: (paths: string[]) => void; setActive: (v: boolean) => void };

const zones = new Map<string, Zone>();
let listening: Promise<void> | null = null;
let activeZone: string | null = null;

function zoneAt(x: number, y: number): string | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const id = el.dataset.dropZone;
    if (id && zones.has(id)) return id;
    el = el.parentElement;
  }
  return null;
}

function setActive(id: string | null) {
  if (id === activeZone) return;
  if (activeZone) zones.get(activeZone)?.setActive(false);
  activeZone = id;
  if (id) zones.get(id)?.setActive(true);
}

function ensureListener() {
  if (listening || !("__TAURI_INTERNALS__" in window)) return;
  listening = import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
    await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") return setActive(null);
      // Positions are physical pixels; the DOM works in CSS pixels.
      const x = payload.position.x / window.devicePixelRatio;
      const y = payload.position.y / window.devicePixelRatio;
      const id = zoneAt(x, y);
      if (payload.type === "drop") {
        setActive(null);
        if (id && payload.paths.length) zones.get(id)?.onDrop(payload.paths);
      } else {
        setActive(id);
      }
    });
  });
}

/**
 * Returns props to spread on the drop target and whether files are being
 * dragged over it. `onDrop` receives absolute file paths.
 */
export function useFileDrop(onDrop: (paths: string[]) => void, enabled = true) {
  const id = useId();
  const [active, setActiveState] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    ensureListener();
    zones.set(id, { onDrop, setActive: setActiveState });
    return () => {
      zones.delete(id);
      if (activeZone === id) activeZone = null;
    };
  }, [id, onDrop, enabled]);

  return { dropProps: { "data-drop-zone": id }, isDragOver: active };
}
