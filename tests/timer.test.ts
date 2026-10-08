import { describe, expect, it } from "vitest";
import { IDLE, pause, remaining, resume, skipBreak, start, stop, tick, TIMER_MODES, type ActiveTimer } from "../src/features/study/timerMachine";

const MIN = 60_000;
const ctx = { programmeId: null, courseId: "ml", topic: "Gradient descent", taskId: null };
const pomodoro = TIMER_MODES[0]!; // 25/5
const t0 = 1_000_000_000;

describe("study timer", () => {
  it("records a finished focus block and starts the break", () => {
    const s = start(pomodoro, ctx, t0, "2026-10-06T19:00");
    expect(remaining(s, t0 + 10 * MIN)).toBe(15 * MIN);
    expect(tick(s, t0 + 24 * MIN, "2026-10-06T19:24").effects).toEqual([]);
    const r = tick(s, t0 + 25 * MIN, "2026-10-06T19:25");
    expect(r.effects[0]).toEqual({ type: "record", startedAt: "2026-10-06T19:00", minutes: 25, ctx, mode: "25/5" });
    expect(r.effects[1]).toMatchObject({ type: "notify", title: "🧠 Focus block done" });
    expect(r.state).toMatchObject({ phase: "break", cycle: 1, phaseLengthMs: 5 * MIN });
  });

  it("goes back to focus after the break with the right start time", () => {
    let s = tick(start(pomodoro, ctx, t0, "2026-10-06T19:00"), t0 + 25 * MIN, "2026-10-06T19:25").state;
    const r = tick(s, t0 + 31 * MIN, "2026-10-06T19:31"); // 1 minute late
    s = r.state;
    expect(r.effects).toEqual([{ type: "notify", title: "⏱ Break over", body: "Back to focus for 25 minutes." }]);
    expect(s).toMatchObject({ phase: "focus", phaseStartedLocal: "2026-10-06T19:30" });
    expect(remaining(s, t0 + 31 * MIN)).toBe(24 * MIN);
  });

  it("pauses without losing time", () => {
    let s = start(pomodoro, ctx, t0, "2026-10-06T19:00");
    s = pause(s, t0 + 10 * MIN);
    expect(remaining(s, t0 + 60 * MIN)).toBe(15 * MIN);
    expect(tick(s, t0 + 60 * MIN, "x").effects).toEqual([]);
    s = resume(s, t0 + 60 * MIN);
    expect(remaining(s, t0 + 65 * MIN)).toBe(10 * MIN);
  });

  it("records a partial block on stop, but not under a minute or during a break", () => {
    const s = start(pomodoro, ctx, t0, "2026-10-06T19:00");
    expect(stop(s, t0 + 12 * MIN + 30_000).effects).toEqual([{ type: "record", startedAt: "2026-10-06T19:00", minutes: 12, ctx, mode: "25/5" }]);
    expect(stop(s, t0 + 30_000).effects).toEqual([]);
    const onBreak = tick(s, t0 + 25 * MIN, "2026-10-06T19:25").state;
    expect(stop(onBreak, t0 + 27 * MIN)).toEqual({ state: IDLE, effects: [] });
  });

  it("stops instead of inventing time after a long sleep", () => {
    const s = start(pomodoro, ctx, t0, "2026-10-06T19:00");
    const r = tick(s, t0 + 3 * 60 * MIN, "2026-10-06T22:00");
    expect(r.state).toEqual(IDLE);
    expect(r.effects.filter((e) => e.type === "record")).toHaveLength(1);
  });

  it("can skip a break", () => {
    const onBreak = tick(start(pomodoro, ctx, t0, "2026-10-06T19:00"), t0 + 25 * MIN, "2026-10-06T19:25").state as ActiveTimer;
    const s = skipBreak(onBreak, t0 + 26 * MIN, "2026-10-06T19:26");
    expect(s).toMatchObject({ phase: "focus", phaseStartedLocal: "2026-10-06T19:26", cycle: 1 });
  });
});
