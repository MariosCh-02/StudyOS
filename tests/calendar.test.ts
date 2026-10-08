import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { scaleFromPreset } from "../src/domain/grading";
import { ValidationError } from "../src/domain/validation";
import { findConflicts } from "../src/domain/conflicts";
import { parseIcs } from "../src/domain/ics";
import { createInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createCourse, deleteCourse } from "../src/services/courses";
import {
  cancelOccurrence,
  createEvent,
  createRecurring,
  deleteRecurring,
  endRecurringBefore,
  getCalendarItems,
  getDayItems,
  moveOccurrence,
  restoreOccurrence,
  updateRecurring,
  type RecurringInput,
} from "../src/services/calendar";
import { exportIcs, importIcs, previewIcs } from "../src/services/icsTransfer";
import { getOrCreateLectureForDate } from "../src/services/lectures";

let courseId: string;

beforeEach(async () => {
  await createTestDb();
  const i = await createInstitution({ name: "UCY", kind: "university", country: null, website: null, notes: null });
  const p = await createProgramme({
    institutionId: i.id,
    name: "MSc AI",
    level: "master",
    status: "active",
    field: null,
    startDate: null,
    endDate: null,
    totalCredits: null,
    creditUnit: "ECTS",
    gradingScale: scaleFromPreset("ten_point"),
    targetGrade: null,
    color: null,
    notes: null,
  });
  const c = await createCourse({
    programmeId: p.id,
    semesterId: null,
    name: "Machine Learning",
    code: "MAI611",
    credits: 10,
    lecturer: "Dr. Smith",
    lecturerEmail: null,
    location: null,
    status: "in_progress",
    finalGrade: null,
    targetGrade: null,
    color: "#7b8ff7",
    description: null,
  });
  courseId = c.id;
});

const mlClass = (over: Partial<RecurringInput> = {}): RecurringInput => ({
  type: "class",
  title: "Machine Learning",
  courseId,
  semesterId: null,
  weekdays: [2],
  startTime: "17:00",
  endTime: "19:00",
  startDate: "2026-09-01",
  endDate: "2026-12-15",
  intervalWeeks: 1,
  location: "B204",
  lecturer: "Dr. Smith",
  notes: null,
  ...over,
});

const work = (over: Partial<RecurringInput> = {}): RecurringInput => ({
  ...mlClass(),
  type: "work",
  title: "Work",
  courseId: null,
  weekdays: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "16:00",
  endDate: null,
  location: null,
  lecturer: null,
  ...over,
});

describe("recurring items", () => {
  it("validates input", async () => {
    await expect(createRecurring(mlClass({ weekdays: [] }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createRecurring(mlClass({ endTime: "17:00" }))).rejects.toThrow(/differ/);
    await expect(createRecurring(mlClass({ endDate: "2026-08-01" }))).rejects.toThrow(/after the first date/);
    await expect(createRecurring(mlClass({ startTime: "5pm" }))).rejects.toThrow(/HH:MM/);
  });

  it("shows a work week with the class and its course colour", async () => {
    await createRecurring(work());
    await createRecurring(mlClass());
    const week = await getCalendarItems("2026-10-05", "2026-10-11");
    expect(week.filter((i) => i.type === "work")).toHaveLength(5);
    const cls = week.find((i) => i.type === "class")!;
    expect(cls).toMatchObject({ start: "2026-10-06T17:00", courseCode: "MAI611", courseColor: "#7b8ff7", location: "B204" });
  });

  it("cancels, moves and restores single occurrences", async () => {
    const s = await createRecurring(mlClass());
    await cancelOccurrence(s.id, "2026-10-06");
    expect(await getDayItems("2026-10-06")).toHaveLength(0);
    await moveOccurrence(s.id, "2026-10-06", "2026-10-08T10:00", "2026-10-08T12:00", "A101");
    const moved = (await getDayItems("2026-10-08"))[0]!;
    expect(moved).toMatchObject({ moved: true, location: "A101", key: `${s.id}@2026-10-06` });
    await restoreOccurrence(s.id, "2026-10-06");
    expect((await getDayItems("2026-10-06"))[0]?.start).toBe("2026-10-06T17:00");
    expect(await getDayItems("2026-10-08")).toHaveLength(0);
  });

  it("applies rule edits to every week and can end a series", async () => {
    const s = await createRecurring(mlClass());
    await updateRecurring(s.id, { ...mlClass(), startTime: "18:00", endTime: "20:00", location: "C1" });
    expect((await getDayItems("2026-11-03"))[0]).toMatchObject({ start: "2026-11-03T18:00", location: "C1" });
    await endRecurringBefore(s.id, "2026-11-01");
    expect(await getDayItems("2026-11-03")).toHaveLength(0);
    expect(await getDayItems("2026-10-27")).toHaveLength(1);
    await deleteRecurring(s.id);
    expect(await getCalendarItems("2026-09-01", "2026-12-31")).toHaveLength(0);
  });

  it("includes overnight items on the day they end", async () => {
    await createRecurring(work({ weekdays: [1], startTime: "22:00", endTime: "06:00" }));
    const tue = await getDayItems("2026-10-06");
    expect(tue).toHaveLength(1);
    expect(tue[0]?.start).toBe("2026-10-05T22:00");
  });

  it("hides items of deleted courses", async () => {
    await createRecurring(mlClass());
    await deleteCourse(courseId);
    expect(await getCalendarItems("2026-09-01", "2026-12-31")).toHaveLength(0);
  });

  it("detects the class/work conflict from stored data", async () => {
    await createRecurring(work({ endTime: "17:30" }));
    await createRecurring(mlClass());
    const conflicts = findConflicts(await getDayItems("2026-10-06"));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlap).toBe(30);
  });
});

describe("events", () => {
  it("validates and lists events overlapping the range", async () => {
    await expect(createEvent({ type: "study", title: "x", start: "2026-10-06T10:00", end: "2026-10-06T09:00", allDay: false, courseId: null, location: null, notes: null })).rejects.toThrow(/after the start/);
    await createEvent({ type: "personal", title: "Trip", start: "2026-10-09T00:00", end: "2026-10-12T00:00", allDay: true, courseId: null, location: null, notes: null });
    expect((await getCalendarItems("2026-10-10", "2026-10-10")).map((i) => i.title)).toEqual(["Trip"]);
  });
});

describe("lectures from the timetable", () => {
  it("finds or creates the lecture for a class date with its time", async () => {
    const l = await getOrCreateLectureForDate(courseId, "2026-10-06", "17:00");
    expect(l).toMatchObject({ number: 1, date: "2026-10-06", startTime: "17:00" });
    expect((await getOrCreateLectureForDate(courseId, "2026-10-06", "17:00")).id).toBe(l.id);
  });
});

const TIMETABLE = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:ml@ucy",
  "DTSTART;TZID=Europe/Nicosia:20260908T170000",
  "DTEND;TZID=Europe/Nicosia:20260908T190000",
  "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261215T235959Z",
  "EXDATE;TZID=Europe/Nicosia:20261027T170000",
  "SUMMARY:Machine Learning",
  "LOCATION:B204",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ml@ucy",
  "RECURRENCE-ID;TZID=Europe/Nicosia:20261103T170000",
  "DTSTART;TZID=Europe/Nicosia:20261104T090000",
  "DTEND;TZID=Europe/Nicosia:20261104T110000",
  "SUMMARY:Machine Learning (moved)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:orientation@ucy",
  "DTSTART;TZID=Europe/Nicosia:20260901T100000",
  "DTEND;TZID=Europe/Nicosia:20260901T120000",
  "SUMMARY:Orientation",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:cancelled@ucy",
  "STATUS:CANCELLED",
  "DTSTART;TZID=Europe/Nicosia:20260902T100000",
  "DTEND;TZID=Europe/Nicosia:20260902T120000",
  "SUMMARY:Cancelled",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("ICS import/export", () => {
  it("previews and imports a university timetable", async () => {
    expect(previewIcs(TIMETABLE)).toMatchObject({ total: 4, recurring: 1, single: 1, overrides: 1, cancelled: 1 });
    const r = await importIcs(TIMETABLE, { type: "class", courseId });
    expect(r).toMatchObject({ created: 2, skipped: 1, updated: 1 });

    const oct = await getCalendarItems("2026-10-26", "2026-10-31");
    expect(oct.map((i) => i.start)).toEqual(["2026-10-29T17:00"]); // 27th excluded
    const moved = await getCalendarItems("2026-11-02", "2026-11-05");
    expect(moved.map((i) => i.start)).toEqual(["2026-11-04T09:00", "2026-11-05T17:00"]);
    expect(moved[0]).toMatchObject({ courseCode: "MAI611", type: "class" });
  });

  it("re-importing updates instead of duplicating", async () => {
    await importIcs(TIMETABLE, { type: "class", courseId });
    const again = await importIcs(TIMETABLE.replace("LOCATION:B204", "LOCATION:C300"), { type: "class", courseId });
    expect(again.created).toBe(0);
    const items = await getDayItems("2026-09-08");
    expect(items).toHaveLength(1);
    expect(items[0]?.location).toBe("C300");
  });

  it("exports everything back to a valid calendar", async () => {
    await importIcs(TIMETABLE, { type: "class", courseId });
    await createRecurring(work());
    const text = await exportIcs();
    const back = parseIcs(text).events;
    expect(back.map((e) => e.summary).sort()).toEqual(["Machine Learning", "Machine Learning", "Orientation", "Work"]);
    const ml = back.find((e) => e.uid === "ml@ucy")!;
    expect(ml.exdates.sort()).toEqual(["2026-10-27", "2026-11-03"]);
  });
});
