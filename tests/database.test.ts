import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import type { DbDriver } from "../src/lib/db/driver";
import { scaleFromPreset } from "../src/domain/grading";
import { ValidationError } from "../src/domain/validation";
import type { CourseInput, InstitutionInput, ProgrammeInput } from "../src/domain/types";
import { createInstitution, deleteInstitution, listInstitutions, updateInstitution } from "../src/services/institutions";
import { createProgramme, deleteProgramme, getProgramme, listProgrammes } from "../src/services/programmes";
import {
  createAcademicYear,
  createSemester,
  deleteSemester,
  listAcademicYears,
  listSemestersForProgramme,
} from "../src/services/terms";
import { createCourse, getCourse, listCourses, updateCourse } from "../src/services/courses";
import { getAllSettings, getProfile, getSetting, setSetting, updateProfile } from "../src/services/settings";
import { getDashboard } from "../src/services/dashboard";

const institution = (over: Partial<InstitutionInput> = {}): InstitutionInput => ({
  name: "University of Cyprus",
  kind: "university",
  country: "Cyprus",
  website: null,
  notes: null,
  ...over,
});

const programme = (institutionId: string, over: Partial<ProgrammeInput> = {}): ProgrammeInput => ({
  institutionId,
  name: "MSc Artificial Intelligence",
  level: "master",
  status: "active",
  field: "Computer Science",
  startDate: "2026-09-01",
  endDate: "2028-06-30",
  totalCredits: 90,
  creditUnit: "ECTS",
  gradingScale: scaleFromPreset("ten_point"),
  targetGrade: 9.5,
  color: null,
  notes: null,
  ...over,
});

const course = (programmeId: string, over: Partial<CourseInput> = {}): CourseInput => ({
  programmeId,
  semesterId: null,
  name: "Machine Learning",
  code: "MAI611",
  credits: 10,
  lecturer: "Dr. Smith",
  lecturerEmail: null,
  location: "B204",
  status: "in_progress",
  finalGrade: null,
  targetGrade: null,
  color: null,
  description: null,
  ...over,
});

let db: DbDriver;
beforeEach(async () => {
  db = await createTestDb();
});

describe("migrations", () => {
  it("creates the schema with seeded tags and enforces foreign keys", async () => {
    const tags = await db.select<{ name: string }>("SELECT name FROM tags ORDER BY name");
    expect(tags.map((t) => t.name)).toContain("confusing");
    await expect(
      db.execute(
        "INSERT INTO programmes (id, institution_id, name, grading_scale, created_at, updated_at) VALUES ('p', 'missing', 'X', '{}', 'now', 'now')",
      ),
    ).rejects.toThrow();
  });
});

describe("institutions", () => {
  it("creates, lists and updates", async () => {
    const i = await createInstitution(institution({ name: "  University of London " }));
    expect(i.name).toBe("University of London");
    await updateInstitution(i.id, institution({ name: "UoL", kind: "online" }));
    const all = await listInstitutions();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: "UoL", kind: "online" });
  });

  it("validates input", async () => {
    await expect(createInstitution(institution({ name: "  " }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createInstitution(institution({ website: "ftp://x" }))).rejects.toThrow(/http/);
  });

  it("soft-deletes the whole tree", async () => {
    const i = await createInstitution(institution());
    const p = await createProgramme(programme(i.id));
    await createCourse(course(p.id));
    await deleteInstitution(i.id);
    expect(await listInstitutions()).toHaveLength(0);
    expect(await listProgrammes()).toHaveLength(0);
    expect(await listCourses()).toHaveLength(0);
    // Rows remain on disk for recovery.
    const raw = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM courses WHERE deleted_at IS NOT NULL");
    expect(raw[0]!.n).toBe(1);
    expect(await getSetting("activeProgrammeId")).toBe("");
  });
});

describe("programmes", () => {
  it("supports multiple programmes and sets the first as active", async () => {
    const i = await createInstitution(institution());
    const msc = await createProgramme(programme(i.id));
    const bsc = await createProgramme(programme(i.id, { name: "BSc Computer Science", level: "bachelor", status: "completed" }));
    const phd = await createProgramme(programme(i.id, { name: "PhD AI", level: "doctorate", status: "planned" }));
    expect(await getSetting("activeProgrammeId")).toBe(msc.id);
    // Active first, then planned, then completed.
    expect((await listProgrammes()).map((p) => p.id)).toEqual([msc.id, phd.id, bsc.id]);
    expect((await getProgramme(msc.id))?.gradingScale.max).toBe(10);
    expect((await getProgramme(msc.id))?.institutionName).toBe("University of Cyprus");
  });

  it("moves the active programme when it is deleted", async () => {
    const i = await createInstitution(institution());
    const a = await createProgramme(programme(i.id));
    const b = await createProgramme(programme(i.id, { name: "Other" }));
    await deleteProgramme(a.id);
    expect(await getSetting("activeProgrammeId")).toBe(b.id);
  });

  it("rejects targets outside the grading scale and bad date order", async () => {
    const i = await createInstitution(institution());
    await expect(createProgramme(programme(i.id, { targetGrade: 11 }))).rejects.toThrow(/between 0 and 10/);
    await expect(createProgramme(programme(i.id, { startDate: "2027-01-01", endDate: "2026-01-01" }))).rejects.toThrow(
      /End date/,
    );
  });
});

describe("academic years, semesters and courses", () => {
  it("builds the hierarchy and keeps courses when a semester is removed", async () => {
    const i = await createInstitution(institution());
    const p = await createProgramme(programme(i.id));
    const y = await createAcademicYear({ programmeId: p.id, label: "2026–2027", startDate: "2026-09-01", endDate: "2027-06-30" });
    const s1 = await createSemester({ academicYearId: y.id, label: "Semester 1", startDate: "2026-09-01", endDate: "2026-12-20" });
    const s2 = await createSemester({ academicYearId: y.id, label: "Semester 2", startDate: "2027-01-20", endDate: "2027-05-30" });
    expect((await listAcademicYears(p.id)).map((x) => x.label)).toEqual(["2026–2027"]);
    expect((await listSemestersForProgramme(p.id)).map((s) => [s.label, s.sortOrder])).toEqual([
      ["Semester 1", 0],
      ["Semester 2", 1],
    ]);

    const c = await createCourse(course(p.id, { semesterId: s1.id }));
    expect(await listCourses({ semesterId: s1.id })).toHaveLength(1);
    await deleteSemester(s1.id);
    expect((await getCourse(c.id))?.semesterId).toBeNull();
    expect(await listSemestersForProgramme(p.id)).toHaveLength(1);
    expect(s2.label).toBe("Semester 2");
  });

  it("validates grades against the programme scale and semester ownership", async () => {
    const i = await createInstitution(institution());
    const p = await createProgramme(programme(i.id));
    const other = await createProgramme(programme(i.id, { name: "Other" }));
    const y = await createAcademicYear({ programmeId: other.id, label: "Y1", startDate: null, endDate: null });
    const foreign = await createSemester({ academicYearId: y.id, label: "S1", startDate: null, endDate: null });
    await expect(createCourse(course(p.id, { finalGrade: 12 }))).rejects.toThrow(/between 0 and 10/);
    await expect(createCourse(course(p.id, { semesterId: foreign.id }))).rejects.toThrow(/does not belong/);
    const c = await createCourse(course(p.id));
    const updated = await updateCourse(c.id, course(p.id, { status: "completed", finalGrade: 9.25 }));
    expect(updated.finalGrade).toBe(9.25);
  });
});

describe("settings and profile", () => {
  it("returns defaults and persists valid values", async () => {
    expect((await getAllSettings()).theme).toBe("dark");
    await setSetting("theme", "light");
    expect(await getSetting("theme")).toBe("light");
    await expect(setSetting("theme", "neon" as never)).rejects.toThrow();
    await updateProfile({ displayName: "  Maria " });
    expect((await getProfile()).displayName).toBe("Maria");
  });
});

describe("dashboard", () => {
  it("summarises the active programme and current semester", async () => {
    expect((await getDashboard("2026-10-05")).programme).toBeNull();

    const i = await createInstitution(institution());
    const p = await createProgramme(programme(i.id));
    const y = await createAcademicYear({ programmeId: p.id, label: "2026–2027", startDate: null, endDate: null });
    const s1 = await createSemester({ academicYearId: y.id, label: "Semester 1", startDate: "2026-09-01", endDate: "2026-12-20" });
    await createCourse(course(p.id, { semesterId: s1.id }));
    await createCourse(course(p.id, { name: "Prior Learning", semesterId: null, status: "completed", finalGrade: 8, credits: 10 }));

    const d = await getDashboard("2026-10-05");
    expect(d.programme?.id).toBe(p.id);
    expect(d.currentSemester?.id).toBe(s1.id);
    expect(d.currentCourses.map((c) => c.name)).toEqual(["Machine Learning"]);
    expect(d.stats?.average).toBe(8);
    expect(d.stats?.progress).toBeCloseTo(10 / 90, 10);
  });
});
