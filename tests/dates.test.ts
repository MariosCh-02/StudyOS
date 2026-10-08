import { describe, expect, it } from "vitest";
import { greetingFor, isDateKey, pickCurrentPeriod, toDateKey } from "../src/domain/dates";

describe("date keys", () => {
  it("formats local dates", () => {
    expect(toDateKey(new Date(2026, 9, 5))).toBe("2026-10-05");
  });

  it("validates calendar dates", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("26-1-1")).toBe(false);
  });
});

describe("greetingFor", () => {
  it.each([
    [7, "Good morning"],
    [13, "Good afternoon"],
    [20, "Good evening"],
    [2, "Good evening"],
  ])("hour %i → %s", (h, expected) => {
    expect(greetingFor(new Date(2026, 0, 1, h))).toBe(expected);
  });
});

describe("pickCurrentPeriod", () => {
  const s1 = { id: "s1", startDate: "2026-09-01", endDate: "2026-12-20" };
  const s2 = { id: "s2", startDate: "2027-01-20", endDate: "2027-05-30" };
  const undated = { id: "u", startDate: null, endDate: null };

  it("prefers the period containing today", () => {
    expect(pickCurrentPeriod([s1, s2], "2026-10-05")?.id).toBe("s1");
    expect(pickCurrentPeriod([s1, s2], "2027-02-01")?.id).toBe("s2");
  });

  it("uses the most recent period during a break", () => {
    expect(pickCurrentPeriod([s1, s2], "2027-01-05")?.id).toBe("s1");
  });

  it("uses the next upcoming period before anything starts", () => {
    expect(pickCurrentPeriod([s2, s1], "2026-06-01")?.id).toBe("s1");
  });

  it("handles empty and undated input", () => {
    expect(pickCurrentPeriod([], "2026-10-05")).toBeNull();
    expect(pickCurrentPeriod([undated], "2026-10-05")?.id).toBe("u");
  });
});
