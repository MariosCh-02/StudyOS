/** Opens http(s)/mailto links in the user's browser or mail app, never inside StudyOS. */
export async function openExternal(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (!("__TAURI_INTERNALS__" in window)) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/**
 * Prevents link clicks from navigating the app window: external links open in
 * the default browser; anything else is ignored. Installed once at startup.
 */
export function installExternalLinkGuard(): void {
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) return; // in-app routes
    // Links inside the editor are opened deliberately (Ctrl+click), see NoteEditor.
    if (a.closest(".ProseMirror[contenteditable='true']")) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    void openExternal(href);
  });
}
