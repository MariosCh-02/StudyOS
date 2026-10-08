/**
 * Pending-work registry: anything holding unsaved state (open note editors)
 * registers a flush function, and the app flushes all of them before the
 * window closes or is hidden.
 */
const flushers = new Set<() => Promise<void>>();

export function registerFlush(fn: () => Promise<void>): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((f) => f()));
}

const TRAY_HINT_KEY = "studyos.trayHintShown";

/** The first time the window is closed to the tray, say where StudyOS went. */
async function tellOnceAboutTray() {
  try {
    if (localStorage.getItem(TRAY_HINT_KEY)) return;
    localStorage.setItem(TRAY_HINT_KEY, "1");
    const { isPermissionGranted, sendNotification } = await import("@tauri-apps/plugin-notification");
    if (await isPermissionGranted()) {
      sendNotification({ title: "StudyOS is still running", body: "Reminders keep working. Open it from the tray icon, or quit from the tray menu. You can change this in Settings." });
    }
  } catch {
    // Only a hint.
  }
}

/** Hooks window close / hide so unsaved notes are written first. */
export function installFlushOnExit(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAll();
  });
  if (!("__TAURI_INTERNALS__" in window)) return;
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
    // The window closes after this handler resolves.
    getCurrentWindow().onCloseRequested(async (event) => {
      await Promise.race([flushAll(), new Promise((r) => setTimeout(r, 3000))]);
      // Keep running in the tray (reminders, timer) unless the user turned that off.
      const { getSetting } = await import("@/services/settings");
      const toTray = await getSetting("closeToTray").catch(() => "off" as const);
      if (toTray !== "on") return;
      event.preventDefault();
      await getCurrentWindow().hide();
      await tellOnceAboutTray();
    }),
  );
}
