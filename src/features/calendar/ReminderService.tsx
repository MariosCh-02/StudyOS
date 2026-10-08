import { useEffect } from "react";
import { useSettings } from "@/hooks/queries";
import { addDays, nowLocal } from "@/domain/time";
import { getCalendarItems } from "@/services/calendar";
import { dueCounts } from "@/services/practice";
import { dueReminders } from "./reminders";

const SENT_KEY = "studyos.remindersSent";
const CHECK_MS = 30_000;

function loadSent(): Map<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SENT_KEY) ?? "{}") as Record<string, number>;
    // Forget entries older than three days.
    const cutoff = Date.now() - 3 * 86_400_000;
    return new Map(Object.entries(raw).filter(([, t]) => t > cutoff));
  } catch {
    return new Map();
  }
}

function saveSent(sent: Map<string, number>) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(sent)));
  } catch {
    // Worst case a reminder repeats after a restart.
  }
}

async function notify(title: string, body: string) {
  const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title, body });
}

/**
 * Sends desktop notifications for upcoming classes, study sessions and exams
 * while StudyOS is running. Renders nothing.
 */
export function ReminderService() {
  const settings = useSettings();
  const enabled = settings.data?.notifications === "on";
  const lead = Number(settings.data?.reminderMinutes ?? 15);

  useEffect(() => {
    if (!enabled || !("__TAURI_INTERNALS__" in window)) return;
    let stopped = false;
    const sent = loadSent();

    const check = async () => {
      try {
        const now = nowLocal();
        const today = now.slice(0, 10);
        const items = await getCalendarItems(today, addDays(today, 2));
        const due = dueReminders(items, now, lead, new Set(sent.keys()));
        for (const r of due) {
          if (stopped) return;
          sent.set(r.id, Date.now());
          await notify(r.title, r.body);
        }
        // Once a day, from 18:00: flashcards and questions due for review.
        const reviewKey = `review:${today}`;
        if (now >= `${today}T18:00` && !sent.has(reviewKey)) {
          const counts = await dueCounts(today);
          sent.set(reviewKey, Date.now());
          const total = counts.cardsDue + counts.questionsDue;
          if (total > 0) await notify("📖 Review time", `${counts.cardsDue} flashcard${counts.cardsDue === 1 ? "" : "s"} and ${counts.questionsDue} question${counts.questionsDue === 1 ? "" : "s"} are due today.`);
          saveSent(sent);
        }
        if (due.length) saveSent(sent);
      } catch {
        // A failed check is retried on the next tick.
      }
    };

    void check();
    const timer = setInterval(() => void check(), CHECK_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, lead]);

  return null;
}
