import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { scaleFromPreset } from "../src/domain/grading";
import { requiredFor } from "../src/domain/assessment";
import { ValidationError } from "../src/domain/validation";
import { createInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createCourse, deleteCourse } from "../src/services/courses";
import {
  createAssignment,
  createExam,
  deleteAssignment,
  getAssignment,
  getCourseStanding,
  listAssignments,
  listExams,
  patchAssignment,
  setExamTopics,
  updateAssignment,
  type AssignmentInput,
  type ExamInput,
} from "../src/services/assessments";
import {
  createTask,
  getCourseAttendance,
  listStudySessions,
  listTasks,
  recordAttendance,
  recordStudySession,
  setTaskStatus,
  type TaskInput,
} from "../src/services/tracking";
import { createRecurring, getCalendarItems } from "../src/services/calendar";
import { addAttachment, listAttachments } from "../src/services/attachments";
import { dueReminders } from "../src/features/calendar/reminders";

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
    totalCredits: 90,
    creditUnit: "ECTS",
    gradingScale: scaleFromPreset("ten_point"),
    targetGrade: 9.5,
    color: null,
    notes: null,
  });
  courseId = (
    await createCourse({
      programmeId: p.id,
      semesterId: null,
      name: "Machine Learning",
      code: "MAI611",
      credits: 10,
      lecturer: null,
      lecturerEmail: null,
      location: null,
      status: "in_progress",
      finalGrade: null,
      targetGrade: null,
      color: null,
      description: null,
    })
  ).id;
});

const assignment = (over: Partial<AssignmentInput> = {}): AssignmentInput => ({
  courseId,
  title: "Assignment 1",
  kind: "assignment",
  description: null,
  dueAt: "2026-10-20T23:59",
  weight: 20,
  status: "not_started",
  score: null,
  maxScore: null,
  checklist: [],
  notes: null,
  ...over,
});

const exam = (over: Partial<ExamInput> = {}): ExamInput => ({
  courseId,
  title: "Final exam",
  kind: "final",
  startAt: "2027-01-15T09:00",
  durationMinutes: 180,
  location: "Hall A",
  topics: [],
  notes: null,
  weight: 60,
  score: null,
  maxScore: null,
  ...over,
});

describe("assignments and exams", () => {
  it("validates grades and marks scored work as graded", async () => {
    await expect(createAssignment(assignment({ weight: 120 }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createAssignment(assignment({ score: 17 }))).rejects.toThrow(/out of/);
    const a = await createAssignment(assignment({ score: 17, maxScore: 20 }));
    expect(a).toMatchObject({ status: "graded" });
    expect(a.submittedAt).not.toBeNull();
  });

  it("reproduces the spec's grade calculator example from stored data", async () => {
    await createAssignment(assignment({ score: 85, maxScore: 100 }));
    await createAssignment(assignment({ title: "Assignment 2", score: 18, maxScore: 20 }));
    await createExam(exam());
    const { standing, items } = await getCourseStanding(courseId);
    expect(items.map((i) => i.title)).toEqual(["Assignment 1", "Assignment 2", "Final exam"]);
    expect(standing.current).toBeCloseTo(87.5, 10);
    expect(requiredFor(standing, 80)).toEqual({ status: "possible", required: expect.closeTo(75, 6) });
  });

  it("keeps checklists and submission state", async () => {
    const a = await createAssignment(assignment({ checklist: [{ id: "", text: " Read brief ", done: false }, { id: "", text: "  ", done: false }] }));
    expect(a.checklist).toHaveLength(1);
    expect(a.checklist[0]).toMatchObject({ text: "Read brief", done: false });
    await patchAssignment(a.id, { checklist: [{ ...a.checklist[0]!, done: true }], status: "submitted" });
    const after = (await getAssignment(a.id))!;
    expect(after.checklist[0]?.done).toBe(true);
    expect(after.submittedAt).not.toBeNull();
    await updateAssignment(a.id, { ...after, status: "in_progress" });
    expect((await getAssignment(a.id))!.submittedAt).toBeNull();
    expect(await listAssignments({ open: true })).toHaveLength(1);
  });

  it("stores exam topics and lists upcoming exams", async () => {
    const e = await createExam(exam());
    await createExam(exam({ title: "Old quiz", kind: "quiz", startAt: "2026-09-01T10:00" }));
    await setExamTopics(e.id, [{ id: "t1", text: "Gradient descent", done: true }]);
    const upcoming = await listExams({ upcomingFrom: "2026-10-06T00:00" });
    expect(upcoming.map((x) => x.title)).toEqual(["Final exam"]);
    expect(upcoming[0]?.topics[0]).toMatchObject({ text: "Gradient descent", done: true });
    expect(upcoming[0]?.courseCode).toBe("MAI611");
  });

  it("puts deadlines and exams on the calendar and in reminders", async () => {
    await createAssignment(assignment());
    await createExam(exam());
    const oct = await getCalendarItems("2026-10-20", "2026-10-20");
    expect(oct[0]).toMatchObject({ source: "assignment", type: "assignment", title: "Due: Assignment 1", start: "2026-10-20T23:59" });
    const jan = await getCalendarItems("2027-01-15", "2027-01-15");
    expect(jan[0]).toMatchObject({ source: "exam", end: "2027-01-15T12:00", location: "Hall A" });
    const due = dueReminders(oct, "2026-10-20T22:30", 15, new Set());
    expect(due[0]?.title).toBe("📝 Assignment 1 is due in 1 h");
  });

  it("cascades course deletion and attaches files", async () => {
    const a = await createAssignment(assignment());
    await addAttachment({ type: "assignment", id: a.id }, { storedName: `${crypto.randomUUID()}.pdf`, fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 10 });
    expect(await listAttachments({ type: "assignment", id: a.id })).toHaveLength(1);
    await deleteCourse(courseId);
    expect(await listAssignments()).toHaveLength(0);
    expect(await listAttachments({ type: "assignment", id: a.id })).toHaveLength(0);
  });

  it("unlinks tasks from deleted assignments", async () => {
    const a = await createAssignment(assignment());
    await createTask({ title: "Write report", notes: null, courseId, assignmentId: a.id, dueAt: null, priority: "high", status: "todo", estimatedMinutes: 90 });
    await deleteAssignment(a.id);
    expect((await listTasks())[0]?.assignmentId).toBeNull();
  });
});

describe("tasks", () => {
  const task = (over: Partial<TaskInput> = {}): TaskInput => ({
    title: "Read chapter 3",
    notes: null,
    courseId: null,
    assignmentId: null,
    dueAt: null,
    priority: "medium",
    status: "todo",
    estimatedMinutes: null,
    ...over,
  });

  it("orders open tasks by due date then priority and records completion", async () => {
    await createTask(task({ title: "later", dueAt: "2026-10-20T12:00" }));
    await createTask(task({ title: "urgent soon", dueAt: "2026-10-10T12:00", priority: "urgent" }));
    const done = await createTask(task({ title: "done" }));
    await setTaskStatus(done.id, "done");
    expect((await listTasks()).map((t) => t.title)).toEqual(["urgent soon", "later", "done"]);
    expect((await listTasks({ open: true })).map((t) => t.title)).not.toContain("done");
    expect((await listTasks()).find((t) => t.title === "done")?.completedAt).not.toBeNull();
    await expect(createTask(task({ estimatedMinutes: 0 }))).rejects.toThrow(/whole minutes/);
  });
});

describe("attendance", () => {
  it("compares records with scheduled classes", async () => {
    await createRecurring({
      type: "class",
      title: "ML",
      courseId,
      semesterId: null,
      weekdays: [2],
      startTime: "17:00",
      endTime: "19:00",
      startDate: "2026-09-01",
      endDate: "2026-12-15",
      intervalWeeks: 1,
      location: null,
      lecturer: null,
      notes: null,
    });
    await recordAttendance(courseId, "2026-09-01", "present");
    await recordAttendance(courseId, "2026-09-08", "absent");
    await recordAttendance(courseId, "2026-09-08", "late"); // correction replaces the earlier record
    const a = await getCourseAttendance(courseId, "2026-09-20");
    expect(a.scheduled).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
    expect(a.stats).toMatchObject({ present: 1, late: 1, absent: 0, unmarked: 1, rate: 1 });
  });
});

describe("study sessions", () => {
  it("records and lists sessions", async () => {
    await recordStudySession({ start: "2026-10-06T19:00", minutes: 25, kind: "timer", mode: "25/5", programmeId: null, courseId, lectureId: null, taskId: null, topic: "Gradient descent", notes: null });
    await recordStudySession({ start: "2026-10-06T17:00", minutes: 110, kind: "lecture", mode: null, programmeId: null, courseId, lectureId: null, taskId: null, topic: null, notes: null });
    await expect(
      recordStudySession({ start: "2026-10-06T19:00", minutes: 0, kind: "timer", mode: null, programmeId: null, courseId: null, lectureId: null, taskId: null, topic: null, notes: null }),
    ).rejects.toThrow(/Minutes/);
    const s = await listStudySessions({ since: "2026-10-01" });
    expect(s.map((x) => x.minutes)).toEqual([25, 110]);
    expect(s[0]?.courseName).toBe("Machine Learning");
  });
});

import { getPerformance } from "../src/services/performance";

describe("performance", () => {
  it("projects the GPA from current standings and recommends the weakest course", async () => {
    await createAssignment(assignment({ score: 85, maxScore: 100 }));
    await createAssignment(assignment({ title: "Assignment 2", score: 18, maxScore: 20 }));
    await createExam(exam());
    const p = (await getPerformance())!;
    expect(p.stats.average).toBeNull(); // no final grades yet
    expect(p.projectedAverage).toBeCloseTo(8.75, 10); // 87.5% on a 10-point scale
    const ml = p.courses[0]!;
    expect(ml.currentPercent).toBeCloseTo(87.5, 10);
    // Target 9.5 = 95%: needs 100% on the final.
    expect(ml.requiredForTarget).toBeCloseTo(100, 6);
    expect(p.assignmentAverage).toBeCloseTo(87.5, 10);
    expect(p.upcoming.map((u) => u.title)).toContain("Final exam");
    expect(p.recommendations.map((r) => r.text).join(" ")).toContain("Your current average is 8.75; your target is 9.50.");
  });
});
