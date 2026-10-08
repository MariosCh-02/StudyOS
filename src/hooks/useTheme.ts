import { useEffect } from "react";
import type { ThemePreference } from "@/services/settings";

const CACHE_KEY = "studyos.theme";

function resolve(pref: ThemePreference): "dark" | "light" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(pref: ThemePreference) {
  document.documentElement.classList.toggle("dark", resolve(pref) === "dark");
}

/** Applies the cached theme synchronously at startup to avoid a flash before the database loads. */
export function applyCachedTheme() {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    // Storage unavailable: fall through to default.
  }
  apply(cached === "light" || cached === "system" ? cached : "dark");
}

/** Keeps <html class="dark"> in sync with the stored preference (and the OS when "system"). */
export function useTheme(pref: ThemePreference | undefined) {
  useEffect(() => {
    if (!pref) return;
    apply(pref);
    try {
      localStorage.setItem(CACHE_KEY, pref);
    } catch {
      // Non-critical cache.
    }
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
}
