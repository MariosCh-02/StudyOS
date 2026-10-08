import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useSettings } from "@/hooks/queries";
import { isTauri } from "@/lib/native";
import { flushAll } from "@/lib/flush";
import { dateOf, nowLocal, timeOf } from "@/domain/time";
import { getDayItems } from "@/services/calendar";
import { getOrCreateLectureForDate } from "@/services/lectures";
import { useTimer } from "@/features/study/TimerProvider";
import { TIMER_MODES } from "@/features/study/timerMachine";

export const setFocusShortcut = async (enabled: boolean) => {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_focus_shortcut", { enabled });
};

/**
 * Connects the tray menu and the optional global shortcut to the app.
 * Renders nothing.
 */
export function DesktopIntegration() {
  const navigate = useNavigate();
  const timer = useTimer();
  const settings = useSettings();
  const actions = useRef({ navigate, timer });
  actions.current = { navigate, timer };

  // Tray menu: Quick Lecture Mode, study timer, quit.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void)[] = [];
    let cancelled = false;
    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
      const offs = await Promise.all([
        listen<string>("tray-action", async (e) => {
          const { navigate: go, timer: t } = actions.current;
          if (e.payload === "timer") {
            if (t.state.status === "idle") t.start(TIMER_MODES[0]!, { courseId: null, programmeId: null, topic: null, taskId: null });
            go("/study");
          } else if (e.payload === "lecture") {
            // The class happening now, else the next one today, else the last one today.
            const now = nowLocal();
            const classes = (await getDayItems(dateOf(now))).filter((i) => i.type === "class" && i.courseId);
            const pick = classes.find((i) => i.start <= now && i.end > now) ?? classes.find((i) => i.start > now) ?? classes[classes.length - 1];
            if (!pick) {
              go("/?noClassToday=1");
              return;
            }
            const lecture = await getOrCreateLectureForDate(pick.courseId!, dateOf(now), timeOf(pick.start));
            go(`/lecture/${lecture.id}`);
          }
        }),
        listen("tray-quit", async () => {
          await Promise.race([flushAll(), new Promise((r) => setTimeout(r, 3000))]);
          await invoke("quit_app");
        }),
      ]);
      if (cancelled) offs.forEach((off) => off());
      else unlisten = offs;
    })();
    return () => {
      cancelled = true;
      unlisten.forEach((off) => off());
    };
  }, []);

  // Optional system-wide Ctrl+Shift+S.
  const shortcut = settings.data?.focusShortcut;
  useEffect(() => {
    if (!isTauri() || !shortcut) return;
    setFocusShortcut(shortcut === "on").catch((err) => console.warn("Global shortcut:", err));
  }, [shortcut]);

  return null;
}
