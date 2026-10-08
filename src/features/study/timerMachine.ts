/**
 * Study timer state machine (Pomodoro-style focus/break cycles).
 * Pure: time is passed in, and side effects (recording a session, sending a
 * notification) are returned for the caller to perform.
 */
import { addMinutes, type LocalDateTime } from "@/domain/time";

export interface TimerMode {
  id: string;
  label: string;
  focus: number; // minutes
  break: number;
}

export const TIMER_MODES: TimerMode[] = [
  { id: "25/5", label: "25 / 5", focus: 25, break: 5 },
  { id: "50/10", label: "50 / 10", focus: 50, break: 10 },
  { id: "90/20", label: "90 / 20", focus: 90, break: 20 },
];

export interface TimerContext {
  programmeId: string | null;
  courseId: string | null;
  topic: string | null;
  taskId: string | null;
}

export type Phase = "focus" | "break";

export interface ActiveTimer {
  status: "running" | "paused";
  mode: TimerMode;
  ctx: TimerContext;
  phase: Phase;
  /** Completed focus blocks in this session. */
  cycle: number;
  phaseLengthMs: number;
  /** Time spent in the current phase before the current running segment. */
  elapsedMs: number;
  /** When the current running segment began (epoch ms); null while paused. */
  segmentStartedAt: number | null;
  /** Wall-clock time the current focus phase began (for the session record). */
  phaseStartedLocal: LocalDateTime;
}

export type TimerState = { status: "idle" } | ActiveTimer;

export type TimerEffect =
  | { type: "record"; startedAt: LocalDateTime; minutes: number; ctx: TimerContext; mode: string }
  | { type: "notify"; title: string; body: string };

const MIN = 60_000;

export const IDLE: TimerState = { status: "idle" };

export function start(mode: TimerMode, ctx: TimerContext, nowMs: number, nowLocal: LocalDateTime): TimerState {
  return { status: "running", mode, ctx, phase: "focus", cycle: 0, phaseLengthMs: mode.focus * MIN, elapsedMs: 0, segmentStartedAt: nowMs, phaseStartedLocal: nowLocal };
}

export function elapsed(s: ActiveTimer, nowMs: number): number {
  return s.elapsedMs + (s.segmentStartedAt != null ? Math.max(0, nowMs - s.segmentStartedAt) : 0);
}

export function remaining(s: TimerState, nowMs: number): number {
  return s.status === "idle" ? 0 : Math.max(0, s.phaseLengthMs - elapsed(s, nowMs));
}

export function pause(s: TimerState, nowMs: number): TimerState {
  if (s.status !== "running") return s;
  return { ...s, status: "paused", elapsedMs: elapsed(s, nowMs), segmentStartedAt: null };
}

export function resume(s: TimerState, nowMs: number): TimerState {
  if (s.status !== "paused") return s;
  return { ...s, status: "running", segmentStartedAt: nowMs };
}

function focusRecord(s: ActiveTimer, minutes: number): TimerEffect {
  return { type: "record", startedAt: s.phaseStartedLocal, minutes, ctx: s.ctx, mode: s.mode.id };
}

/**
 * Advances phases whose time is up. A finished focus block is recorded and a
 * break starts; a finished break starts the next focus block. If the timer
 * overran by more than a whole phase (the PC slept or StudyOS was closed),
 * the finished focus block is recorded and the timer stops instead of
 * inventing study time.
 */
export function tick(s: TimerState, nowMs: number, nowLocal: LocalDateTime): { state: TimerState; effects: TimerEffect[] } {
  if (s.status !== "running") return { state: s, effects: [] };
  const spent = elapsed(s, nowMs);
  if (spent < s.phaseLengthMs) return { state: s, effects: [] };

  const overrun = spent - s.phaseLengthMs;
  const effects: TimerEffect[] = [];
  if (s.phase === "focus") effects.push(focusRecord(s, s.mode.focus));

  const nextPhase: Phase = s.phase === "focus" ? "break" : "focus";
  const nextLength = (nextPhase === "focus" ? s.mode.focus : s.mode.break) * MIN;
  if (overrun > nextLength) {
    effects.push({ type: "notify", title: "Study timer stopped", body: "The timer ran while StudyOS wasn't active, so it was stopped." });
    return { state: IDLE, effects };
  }

  const cycle = s.phase === "focus" ? s.cycle + 1 : s.cycle;
  effects.push(
    nextPhase === "break"
      ? { type: "notify", title: "🧠 Focus block done", body: `Take a ${s.mode.break}-minute break.` }
      : { type: "notify", title: "⏱ Break over", body: `Back to focus for ${s.mode.focus} minutes.` },
  );
  return {
    state: {
      ...s,
      phase: nextPhase,
      cycle,
      phaseLengthMs: nextLength,
      elapsedMs: 0,
      segmentStartedAt: nowMs - overrun,
      phaseStartedLocal: nextPhase === "focus" ? addMinutes(nowLocal, -Math.floor(overrun / MIN)) : s.phaseStartedLocal,
    },
    effects,
  };
}

/** Ends the session; a partial focus block of at least one minute is recorded. */
export function stop(s: TimerState, nowMs: number): { state: TimerState; effects: TimerEffect[] } {
  if (s.status === "idle") return { state: s, effects: [] };
  // Capped at the block length: after sleep or hibernation, time beyond the block isn't study time.
  const minutes = Math.floor(Math.min(elapsed(s, nowMs), s.phaseLengthMs) / MIN);
  return { state: IDLE, effects: s.phase === "focus" && minutes >= 1 ? [focusRecord(s, minutes)] : [] };
}

/** Skips the rest of a break and starts the next focus block. */
export function skipBreak(s: TimerState, nowMs: number, nowLocal: LocalDateTime): TimerState {
  if (s.status === "idle" || s.phase !== "break") return s;
  return { ...s, status: "running", phase: "focus", phaseLengthMs: s.mode.focus * MIN, elapsedMs: 0, segmentStartedAt: nowMs, phaseStartedLocal: nowLocal };
}
