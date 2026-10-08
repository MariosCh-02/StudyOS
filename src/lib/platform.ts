/** True on macOS (the Tauri web view there is WebKit with a "Macintosh" user agent). */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Shortcut label for this platform. Write shortcuts the Windows way
 * ("Ctrl+Shift+M"); on macOS Ctrl becomes Cmd and Alt becomes Option.
 */
export const keys = (shortcut: string): string => (isMac ? shortcut.replace(/\bCtrl\b/g, "Cmd").replace(/\bAlt\b/g, "Option") : shortcut);

/** Where API keys are stored (see src-tauri/src/ai.rs). */
export const KEY_STORE = isMac ? "the macOS Keychain" : "Windows Credential Manager";
