import { describe, expect, it } from "vitest";
import { addDays, addMinutes, addMonths, diffMinutes, isoWeekday, startOfWeek } from "../src/domain/time";
import { countOccurrences, expandRule, occursOn, ruleDuration, type RuleException, type WeeklyRule } from "../src/domain/recurrence";
import { findConflicts, freeSlots, isConflictingPair, suggestAlternatives, type TimedItem } from "../src/domain/conflicts";
import { generateIcs, parseIcs, toWeeklyRule } from "../src/domain/ics";

describe("wall-clock time", () => {
  it("handles weekdays, weeks and months", () => {
    expect(isoWeekday("2026-10-06")).toBe(2); // Tuesday
    expect(isoWeekday("2026-10-11")).toBe(7); // Sunday
    expect(startOfWeek("2026-10-08")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-08", 7)).toBe("2026-10-04");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
  });

  it("is unaffected by daylight-saving changes", () => {
    // EU clocks go back on 2026-10-25; wall-clock arithmetic ignores it.
    expect(diffMinutes("2026-10-25T00:00", "2026-10-25T06:00")).toBe(360);
    expect(addMinutes("2026-03-29T01:30", 60)).toBe("2026-03-29T02:30");
    expect(addMinutes("2026-10-06T23:30", 90)).toBe("2026-10-07T01:00");
  });
});

const ml: WeeklyRule = {
  weekdays: [2], // Tuesdays
  startTime: "17:00",
  endTime: "19:00",
  startDate: "2026-09-01",
  endDate: "2026-12-15",
  intervalWeeks: 1,
};

const ex = (originalDate: string, action: "cancel" | "move", newStart: string | null = null, newEnd: string | null = null, updatedAt = "2026-01-01"): RuleException => ({
  originalDate,
  action,
  newStart,
  newEnd,
  location: null,
  updatedAt,
});

describe("recurrence", () => {
  it("generates every session in the semester", () => {
    const all = expandRule(ml, [], "2026-09-01", "2026-12-31");
    expect(all).toHaveLength(16);
    expect(all[0]).toMatchObject({ start: "2026-09-01T17:00", end: "2026-09-01T19:00" });
    expect(all.at(-1)?.originalDate).toBe("2026-12-15");
    expect(countOccurrences(ml, "2026-12-31")).toBe(16);
  });

  it("supports every-other-week and multiple weekdays", () => {
    const rule = { ...ml, weekdays: [1, 3], intervalWeeks: 2 };
    const dates = expandRule(rule, [], "2026-09-01", "2026-09-30").map((o) => o.originalDate);
    // Week of Aug 31 (on), Sep 7 (off), Sep 14 (on), Sep 21 (off), Sep 28 (on)
    expect(dates).toEqual(["2026-09-02", "2026-09-14", "2026-09-16", "2026-09-28", "2026-09-30"]);
    expect(occursOn(rule, "2026-09-07")).toBe(false);
  });

  it("wraps overnight shifts to the next day", () => {
    const night = { ...ml, startTime: "22:00", endTime: "06:00" };
    expect(ruleDuration(night)).toBe(480);
    expect(expandRule(night, [], "2026-09-01", "2026-09-01")[0]?.end).toBe("2026-09-02T06:00");
  });

  it("applies cancellations and moves, latest exception winning", () => {
    const exceptions = [
      ex("2026-10-06", "cancel"),
      ex("2026-10-13", "cancel", null, null, "2026-01-01"),
      ex("2026-10-13", "move", "2026-10-15T10:00", "2026-10-15T12:00", "2026-02-01"), // later edit wins
    ];
    const occ = expandRule(ml, exceptions, "2026-10-01", "2026-10-31");
    expect(occ.map((o) => o.start)).toEqual(["2026-10-15T10:00", "2026-10-20T17:00", "2026-10-27T17:00"]);
    expect(occ[0]?.moved).toBe(true);
  });

  it("shows an occurrence moved into the range from outside it", () => {
    const moved = [ex("2026-09-29", "move", "2026-10-02T09:00", "2026-10-02T11:00")];
    expect(expandRule(ml, moved, "2026-10-01", "2026-10-05").map((o) => o.originalDate)).toEqual(["2026-09-29"]);
  });

  it("has no end when endDate is null", () => {
    const work = { ...ml, weekdays: [1, 2, 3, 4, 5], endDate: null, startTime: "08:00", endTime: "16:00" };
    expect(expandRule(work, [], "2030-01-07", "2030-01-13")).toHaveLength(5);
  });
});

const item = (key: string, type: TimedItem["type"], start: string, end: string): TimedItem => ({ key, type, title: key, start, end, allDay: false });

describe("conflicts", () => {
  it("flags class vs work, class vs study and exam vs work", () => {
    expect(isConflictingPair("class", "work")).toBe(true);
    expect(isConflictingPair("class", "study")).toBe(true);
    expect(isConflictingPair("exam", "work")).toBe(true);
    expect(isConflictingPair("study", "personal")).toBe(false);
    expect(isConflictingPair("assignment", "class")).toBe(false);
  });

  it("finds overlaps with their length and ignores touching events", () => {
    const items = [
      item("work", "work", "2026-10-06T08:00", "2026-10-06T17:30"),
      item("ml", "class", "2026-10-06T17:00", "2026-10-06T19:00"),
      item("study", "study", "2026-10-06T19:00", "2026-10-06T20:00"),
      { ...item("holiday", "personal", "2026-10-06T00:00", "2026-10-07T00:00"), allDay: true },
    ];
    const c = findConflicts(items);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ overlap: 30 });
    expect([c[0]!.a.key, c[0]!.b.key]).toEqual(["work", "ml"]);
  });

  it("finds free slots and suggests moving the flexible item", () => {
    const items = [
      item("work", "work", "2026-10-06T08:00", "2026-10-06T16:00"),
      item("ml", "class", "2026-10-06T17:00", "2026-10-06T19:00"),
      item("study", "study", "2026-10-06T18:00", "2026-10-06T19:00"),
    ];
    expect(freeSlots(items, "2026-10-06", 60)).toEqual([
      { start: "2026-10-06T16:00", end: "2026-10-06T17:00" },
      { start: "2026-10-06T19:00", end: "2026-10-06T22:00" },
    ]);
    const conflict = findConflicts(items).find((c) => c.b.key === "study" || c.a.key === "study")!;
    const s = suggestAlternatives(conflict, items)!;
    expect(s.item.key).toBe("study");
    expect(s.slots[0]).toEqual({ start: "2026-10-06T16:00", end: "2026-10-06T17:00" });
  });

  it("offers no move when both sides are fixed", () => {
    const items = [item("w", "work", "2026-10-06T08:00", "2026-10-06T18:00"), item("c", "class", "2026-10-06T17:00", "2026-10-06T19:00")];
    expect(suggestAlternatives(findConflicts(items)[0]!, items)).toBeNull();
  });
});

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:ml-lecture@ucy",
  "DTSTART;TZID=Europe/Nicosia:20260908T170000",
  "DTEND;TZID=Europe/Nicosia:20260908T190000",
  "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T235959Z",
  "EXDATE;TZID=Europe/Nicosia:20261027T170000",
  "SUMMARY:MAI611 Machine Learning\\, Lecture",
  "LOCATION:B204",
  "DESCRIPTION:Bring laptop\\nRoom may change",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "ACTION:DISPLAY",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:exam@ucy",
  "DTSTART;VALUE=DATE:20270115",
  "SUMMARY:Exam period",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:lab@ucy",
  "DTSTART:20260910T090000",
  "DURATION:PT1H30M",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "SUMMARY:Lab with a very long title that will need folding when it is exported again because it exceeds seventy-five characters",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:monthly@ucy",
  "DTSTART:20260910T090000",
  "DTEND:20260910T100000",
  "RRULE:FREQ=MONTHLY",
  "SUMMARY:Monthly seminar",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("ICS", () => {
  it("parses timetable events", () => {
    const { events, warnings } = parseIcs(SAMPLE);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(4);
    const [lecture, exam, lab] = events;
    expect(lecture).toMatchObject({
      summary: "MAI611 Machine Learning, Lecture",
      location: "B204",
      description: "Bring laptop\nRoom may change",
      start: "2026-09-08T17:00",
      end: "2026-09-08T19:00",
      exdates: ["2026-10-27"],
    });
    expect(exam).toMatchObject({ allDay: true, start: "2027-01-15T00:00", end: "2027-01-16T00:00" });
    expect(lab?.end).toBe("2026-09-10T10:30");
  });

  it("converts weekly RRULEs, COUNT and unsupported patterns", () => {
    const [lecture, , lab, monthly] = parseIcs(SAMPLE).events;
    expect(toWeeklyRule(lecture!)).toEqual({
      rule: { weekdays: [2], startTime: "17:00", endTime: "19:00", startDate: "2026-09-08", endDate: "2026-12-15", intervalWeeks: 1 },
    });
    expect(toWeeklyRule(lab!).rule?.endDate).toBe("2026-09-24");
    expect(toWeeklyRule(monthly!)).toMatchObject({ rule: null });
  });

  it("converts UTC times to local wall-clock time", () => {
    const text = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20260601T120000Z\nDTEND:20260601T130000Z\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR";
    const e = parseIcs(text).events[0]!;
    const expected = new Date(Date.UTC(2026, 5, 1, 12, 0));
    expect(e.start).toBe(
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}T${String(expected.getHours()).padStart(2, "0")}:00`,
    );
  });

  it("rejects non-calendar files", () => {
    expect(parseIcs("hello").warnings[0]).toMatch(/doesn't look like a calendar/);
  });

  it("round-trips through export", () => {
    const rule: WeeklyRule = { ...ml, weekdays: [2, 4] };
    const text = generateIcs(
      [
        { uid: "a", summary: "ML; Lecture, 1", location: "B204", start: "2026-09-01T17:00", end: "2026-09-01T19:00", rule, exdates: ["2026-10-06"] },
        { uid: "b", summary: "Holiday", start: "2026-10-01T00:00", end: "2026-10-02T00:00", allDay: true },
        { uid: "c", summary: "x".repeat(200), start: "2026-10-03T09:00", end: "2026-10-03T10:00" },
      ],
      { calendarName: "StudyOS", timeZone: "Europe/Nicosia", stamp: "20261006T000000Z" },
    );
    expect(text.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    const back = parseIcs(text).events;
    expect(back[0]).toMatchObject({ summary: "ML; Lecture, 1", location: "B204", exdates: ["2026-10-06"] });
    expect(toWeeklyRule(back[0]!).rule).toMatchObject({ weekdays: [2, 4], endDate: "2026-12-15", startTime: "17:00" });
    expect(back[1]).toMatchObject({ allDay: true, start: "2026-10-01T00:00", end: "2026-10-02T00:00" });
    expect(back[2]?.summary).toBe("x".repeat(200));
  });
});

import { dueReminders, type ReminderItem } from "../src/features/calendar/reminders";

describe("reminders", () => {
  const items: ReminderItem[] = [
    { key: "ml", type: "class", title: "Machine Learning", start: "2026-10-06T17:00", allDay: false, location: "B204" },
    { key: "work", type: "work", title: "Work", start: "2026-10-06T16:55", allDay: false, location: null },
    { key: "exam", type: "exam", title: "Statistics exam", start: "2026-10-07T09:00", allDay: false, location: "Hall A" },
    { key: "final", type: "exam", title: "Finals week", start: "2026-10-07T00:00", allDay: true, location: null },
  ];

  it("reminds about classes inside the lead time, never about work", () => {
    const due = dueReminders(items, "2026-10-06T16:50", 15, new Set());
    expect(due.map((d) => d.id)).toEqual(["ml:soon", "exam:day"]);
    expect(due[0]).toMatchObject({ title: "🎓 Machine Learning starts in 10 min", body: "17:00 · B204" });
    // All-day exams get their heads-up from 18:00 the evening before.
    expect(dueReminders(items, "2026-10-06T18:30", 15, new Set()).map((d) => d.id)).toEqual(["exam:day", "final:eve"]);
  });

  it("fires each reminder once and not for past items", () => {
    const sent = new Set(["ml:soon", "exam:day", "final:eve"]);
    expect(dueReminders(items, "2026-10-06T16:50", 15, sent)).toEqual([]);
    expect(dueReminders(items, "2026-10-06T17:01", 15, new Set()).map((d) => d.id)).not.toContain("ml:soon");
    expect(dueReminders(items, "2026-10-06T16:30", 15, new Set()).map((d) => d.id)).not.toContain("ml:soon");
  });
});

import { layoutDay } from "../src/features/calendar/layout";

describe("day layout", () => {
  const ev = (start: string, end: string, allDay = false) => ({ start, end, allDay });

  it("puts overlapping items side by side and lone items full width", () => {
    const out = layoutDay(
      [ev("2026-10-06T08:00", "2026-10-06T16:00"), ev("2026-10-06T15:00", "2026-10-06T17:00"), ev("2026-10-06T18:00", "2026-10-06T19:00")],
      "2026-10-06",
    );
    expect(out.map((b) => [b.startMin, b.col, b.cols])).toEqual([
      [480, 0, 2],
      [900, 1, 2],
      [1080, 0, 1],
    ]);
  });

  it("reuses freed columns and clips overnight items", () => {
    const out = layoutDay(
      [ev("2026-10-05T22:00", "2026-10-06T06:00"), ev("2026-10-06T05:00", "2026-10-06T07:00"), ev("2026-10-06T06:30", "2026-10-06T08:00"), ev("2026-10-06T00:00", "2026-10-07T00:00", true)],
      "2026-10-06",
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ startMin: 0, endMin: 360, clippedStart: true, col: 0, cols: 2 });
    expect(out[2]).toMatchObject({ startMin: 390, col: 0 });
  });
});
