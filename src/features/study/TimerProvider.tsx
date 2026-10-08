import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { nowLocal } from "@/domain/time";
import { recordStudySession } from "@/services/tracking";
import { getSetting } from "@/services/settings";
import { IDLE, pause, remaining, resume, skipBreak, start, stop, tick, type TimerContext, type TimerEffect, type TimerMode, type TimerState } from "./timerMachine";

const STORAGE_KEY = "studyos.timer";

interface TimerApi {
  state: TimerState;
  remainingMs: number;
  start: (mode: TimerMode, ctx: TimerContext) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skipBreak: () => void;
  error: string | null;
}

const TimerCtx = createContext<TimerApi | null>(null);

export function useTimer(): TimerApi {
  const v = useContext(TimerCtx);
  if (!v) throw new Error("useTimer must be used inside <TimerProvider>.");
  return v;
}

function load(): TimerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TimerState) : IDLE;
  } catch {
    return IDLE;
  }
}

function save(s: TimerState) {
  try {
    if (s.status === "idle") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // The timer still works for this session.
  }
}

async function notify(title: string, body: string) {
  if (!("__TAURI_INTERNALS__" in window) || (await getSetting("notifications")) === "off") return;
  const { isPermissionGranted, sendNotification } = await import("@tauri-apps/plugin-notification");
  if (await isPermissionGranted()) sendNotification({ title, body });
}

/**
 * App-wide study timer. State survives navigation and restarts (it is kept in
 * local storage); finished focus blocks are saved as study sessions.
 */
export function TimerProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<TimerState>(load);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback(
    async (effects: TimerEffect[]) => {
      for (const e of effects) {
        if (e.type === "notify") void notify(e.title, e.body);
        else {
          try {
            await recordStudySession({
              start: e.startedAt,
              minutes: e.minutes,
              kind: "timer",
              mode: e.mode,
              programmeId: e.ctx.programmeId,
              courseId: e.ctx.courseId,
              lectureId: null,
              taskId: e.ctx.taskId,
              topic: e.ctx.topic,
              notes: null,
            });
            setError(null);
            await client.invalidateQueries({ queryKey: ["sessions"] });
            await client.invalidateQueries({ queryKey: ["performance"] });
          } catch (err) {
            setError(`Couldn't save the study session: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    },
    [client],
  );

  const update = useCallback((next: TimerState) => {
    stateRef.current = next;
    setState(next);
    save(next);
  }, []);

  // Tick every second while running (and once on start-up to catch up).
  useEffect(() => {
    const step = () => {
      const t = Date.now();
      setNow(t);
      const r = tick(stateRef.current, t, nowLocal());
      if (r.state !== stateRef.current) update(r.state);
      if (r.effects.length) void apply(r.effects);
    };
    step();
    if (state.status !== "running") return;
    const id = setInterval(step, 1000);
    return () => clearInterval(id);
  }, [state.status, apply, update]);

  const api: TimerApi = {
    state,
    remainingMs: remaining(state, now),
    error,
    start: (mode, ctx) => update(start(mode, ctx, Date.now(), nowLocal())),
    pause: () => update(pause(stateRef.current, Date.now())),
    resume: () => update(resume(stateRef.current, Date.now())),
    skipBreak: () => update(skipBreak(stateRef.current, Date.now(), nowLocal())),
    stop: () => {
      const r = stop(stateRef.current, Date.now());
      update(r.state);
      void apply(r.effects);
    },
  };

  return <TimerCtx.Provider value={api}>{children}</TimerCtx.Provider>;
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}
