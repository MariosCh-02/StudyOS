import { getDb } from "@/lib/db";
import { nowIso } from "@/lib/ids";

export type ThemePreference = "dark" | "light" | "system";
export type WeekStart = "monday" | "sunday";
export const REMINDER_OPTIONS = ["5", "10", "15", "30", "60"] as const;
export type ReminderMinutes = (typeof REMINDER_OPTIONS)[number];

/** All known settings with their types and defaults. */
export interface SettingsMap {
  theme: ThemePreference;
  activeProgrammeId: string;
  weekStart: WeekStart;
  notifications: "on" | "off";
  reminderMinutes: ReminderMinutes;
  topStudentMode: "on" | "off";
  /** Optional AI: "none" keeps every AI feature hidden. API keys are never stored here. */
  aiProvider: "none" | "openai" | "anthropic" | "ollama";
  aiModel: string;
  aiOllamaUrl: string;
  /** Daily local backup (desktop app). */
  autoBackup: "on" | "off";
  /** Closing the window keeps StudyOS running in the system tray. */
  closeToTray: "on" | "off";
  /** System-wide Ctrl+Shift+S focuses StudyOS (off: it would override other apps). */
  focusShortcut: "on" | "off";
}

export const SETTING_DEFAULTS: SettingsMap = {
  theme: "dark",
  activeProgrammeId: "",
  weekStart: "monday",
  notifications: "on",
  reminderMinutes: "15",
  topStudentMode: "off",
  aiProvider: "none",
  aiModel: "",
  aiOllamaUrl: "http://localhost:11434",
  autoBackup: "on",
  closeToTray: "on",
  focusShortcut: "off",
};

const VALIDATORS: { [K in keyof SettingsMap]: (v: string) => boolean } = {
  theme: (v) => v === "dark" || v === "light" || v === "system",
  activeProgrammeId: () => true,
  weekStart: (v) => v === "monday" || v === "sunday",
  notifications: (v) => v === "on" || v === "off",
  reminderMinutes: (v) => (REMINDER_OPTIONS as readonly string[]).includes(v),
  topStudentMode: (v) => v === "on" || v === "off",
  aiProvider: (v) => ["none", "openai", "anthropic", "ollama"].includes(v),
  aiModel: (v) => v.length <= 200 && !/\s/.test(v),
  aiOllamaUrl: (v) => /^https?:\/\/\S+$/.test(v) && v.length <= 300,
  autoBackup: (v) => v === "on" || v === "off",
  closeToTray: (v) => v === "on" || v === "off",
  focusShortcut: (v) => v === "on" || v === "off",
};

export async function getSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
  const db = await getDb();
  const rows = await db.select<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  const raw = rows[0]?.value;
  return (raw != null && VALIDATORS[key](raw) ? raw : SETTING_DEFAULTS[key]) as SettingsMap[K];
}

export async function getAllSettings(): Promise<SettingsMap> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: SettingsMap = { ...SETTING_DEFAULTS };
  for (const { key, value } of rows) {
    if (key in VALIDATORS && VALIDATORS[key as keyof SettingsMap](value)) {
      (out as unknown as Record<string, string>)[key] = value;
    }
  }
  return out;
}

export async function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void> {
  if (!VALIDATORS[key](value)) throw new Error(`Invalid value for setting "${key}".`);
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, nowIso()],
  );
}

export interface UserProfile {
  displayName: string;
}

export async function getProfile(): Promise<UserProfile> {
  const db = await getDb();
  const rows = await db.select<{ display_name: string }>("SELECT display_name FROM user_profile WHERE id = 1");
  return { displayName: rows[0]?.display_name ?? "" };
}

export async function updateProfile(profile: UserProfile): Promise<UserProfile> {
  const name = profile.displayName.trim();
  if (name.length > 80) throw new Error("Name must be at most 80 characters.");
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `INSERT INTO user_profile (id, display_name, created_at, updated_at) VALUES (1, $1, $2, $2)
     ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
    [name, now],
  );
  return { displayName: name };
}
