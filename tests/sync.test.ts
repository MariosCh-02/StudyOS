import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import type { DbDriver } from "../src/lib/db/driver";
import { setDb } from "../src/lib/db";
import {
  countPendingChanges,
  discardAndSwitchOwner,
  prepareLocalForUser,
  syncOnce,
  type RemoteRow,
  type RemoteStore,
  type RowData,
} from "../src/sync/engine";
import { scaleFromPreset } from "../src/domain/grading";
import { createInstitution, deleteInstitution, listInstitutions, updateInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createAcademicYear, createSemester } from "../src/services/terms";
import { createCourse, listCourses } from "../src/services/courses";
import { getProfile, updateProfile } from "../src/services/settings";

/** In-memory stand-in for Firestore with a monotonically increasing server clock. */
class FakeRemote implements RemoteStore {
  clock = 1000;
  tables = new Map<string, Map<string, RemoteRow>>();
  async pull(table: string, sinceMs: number) {
    return [...(this.tables.get(table)?.values() ?? [])]
      .filter((r) => r.syncedAtMs > sinceMs)
      .sort((a, b) => a.syncedAtMs - b.syncedAtMs);
  }
  async push(table: string, rows: { id: string; data: RowData }[]) {
    const t = this.tables.get(table) ?? new Map<string, RemoteRow>();
    for (const r of rows) t.set(r.id, { id: r.id, data: { ...r.data }, syncedAtMs: ++this.clock });
    this.tables.set(table, t);
  }
  count(table: string) {
    return this.tables.get(table)?.size ?? 0;
  }
}

/** Runs service calls against a specific device database. */
async function on<T>(device: DbDriver, fn: () => Promise<T>): Promise<T> {
  setDb(device);
  return fn();
}

const institution = { name: "University of Cyprus", kind: "university" as const, country: "Cyprus", website: null, notes: null };

async function seed() {
  const i = await createInstitution(institution);
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
    targetGrade: null,
    color: null,
    notes: null,
  });
  const y = await createAcademicYear({ programmeId: p.id, label: "2026–2027", startDate: null, endDate: null });
  const s = await createSemester({ academicYearId: y.id, label: "Semester 1", startDate: null, endDate: null });
  const c = await createCourse({
    programmeId: p.id,
    semesterId: s.id,
    name: "Machine Learning",
    code: null,
    credits: 10,
    lecturer: null,
    lecturerEmail: null,
    location: null,
    status: "in_progress",
    finalGrade: null,
    targetGrade: null,
    color: null,
    description: null,
  });
  return { i, p, y, s, c };
}

describe("sync engine", () => {
  it("uploads local data and downloads it on another device", async () => {
    const remote = new FakeRemote();
    const a = await createTestDb();
    await seed();
    expect(await countPendingChanges(a)).toBeGreaterThan(0);

    const r1 = await syncOnce(a, remote);
    expect(r1.pushed).toBeGreaterThanOrEqual(5);
    expect(await countPendingChanges(a)).toBe(0);
    expect(remote.count("courses")).toBe(1);

    // Second sync is a no-op.
    expect(await syncOnce(a, remote)).toEqual({ pulled: 0, pushed: 0, deferred: 0 });

    const b = await createTestDb();
    const r2 = await syncOnce(b, remote);
    expect(r2.deferred).toBe(0);
    expect(r2.pushed).toBe(0); // nothing echoed back
    const courses = await on(b, () => listCourses());
    expect(courses.map((c) => c.name)).toEqual(["Machine Learning"]);
  });

  it("propagates edits and soft deletes, newest change wins", async () => {
    const remote = new FakeRemote();
    const a = await createTestDb();
    const { i } = await seed();
    await syncOnce(a, remote);
    const b = await createTestDb();
    await syncOnce(b, remote);

    // B renames; A then renames later. A's (newer) change must win everywhere.
    await on(b, () => updateInstitution(i.id, { ...institution, name: "UCY (B)" }));
    await new Promise((r) => setTimeout(r, 5));
    await on(a, () => updateInstitution(i.id, { ...institution, name: "UCY (A)" }));
    await syncOnce(b, remote);
    await syncOnce(a, remote); // pulls B's older edit (ignored), pushes A's
    await syncOnce(b, remote);
    expect((await on(a, () => listInstitutions()))[0]?.name).toBe("UCY (A)");
    expect((await on(b, () => listInstitutions()))[0]?.name).toBe("UCY (A)");

    await on(a, () => deleteInstitution(i.id));
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    expect(await on(b, () => listInstitutions())).toHaveLength(0);
    expect(await on(b, () => listCourses())).toHaveLength(0);
  });

  it("syncs the profile row", async () => {
    const remote = new FakeRemote();
    const a = await createTestDb();
    await updateProfile({ displayName: "Maria" });
    await syncOnce(a, remote);
    const b = await createTestDb();
    await syncOnce(b, remote);
    expect((await on(b, () => getProfile())).displayName).toBe("Maria");
  });
});

describe("local data ownership", () => {
  it("adopts pre-account data for the first account", async () => {
    const db = await createTestDb();
    await seed();
    expect(await prepareLocalForUser(db, "alice")).toEqual({ status: "ready" });
    expect(await on(db, () => listInstitutions())).toHaveLength(1);
    expect(await prepareLocalForUser(db, "alice")).toEqual({ status: "ready" });
  });

  it("clears another account's synced data", async () => {
    const remote = new FakeRemote();
    const db = await createTestDb();
    await prepareLocalForUser(db, "alice");
    await seed();
    await syncOnce(db, remote);
    expect(await prepareLocalForUser(db, "bob")).toEqual({ status: "ready" });
    expect(await on(db, () => listInstitutions())).toHaveLength(0);
    expect(await countPendingChanges(db)).toBe(0);
  });

  it("refuses to silently drop another account's unsynced changes", async () => {
    const db = await createTestDb();
    await prepareLocalForUser(db, "alice");
    await seed();
    const res = await prepareLocalForUser(db, "bob");
    expect(res.status).toBe("conflict");
    expect(await on(db, () => listInstitutions())).toHaveLength(1);
    await discardAndSwitchOwner(db, "bob");
    expect(await on(db, () => listInstitutions())).toHaveLength(0);
    expect(await prepareLocalForUser(db, "bob")).toEqual({ status: "ready" });
  });
});
