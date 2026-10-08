import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarRange, CheckCircle2, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Card, EmptyState, ErrorState, ProgressBar, Spinner, Stat } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useAcademicYears, useCourses, useProgramme, useSemesters, useSettings } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { deleteProgramme as removeProgramme } from "@/services/programmes";
import { deleteAcademicYear, deleteSemester as removeSemester } from "@/services/terms";
import { LABELS, type AcademicYear, type Course, type Semester } from "@/domain/types";
import { computeProgrammeStats, formatGrade, type GradingScale } from "@/domain/grading";
import { formatDateRange } from "@/domain/dates";
import { setSetting } from "@/services/settings";
import type { ProgrammeWithInstitution } from "@/services/programmes";
import { CourseForm } from "./CourseForm";
import { PeriodForm } from "./PeriodForm";
import { ProgrammeForm } from "./ProgrammeForm";
import { ExportMenu } from "@/components/ExportMenu";
import { programmeExports } from "@/features/export/exportItems";

const COURSE_TONE = { planned: "neutral", in_progress: "accent", completed: "success", dropped: "neutral" } as const;

function CourseRow({ course, scale }: { course: Course; scale: GradingScale }) {
  return (
    <li>
      <Link
        to={`/studies/courses/${course.id}`}
        className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: course.color ?? "var(--subtle)" }} />
        <span className="w-20 shrink-0 truncate text-xs text-subtle tabular-nums">{course.code ?? ""}</span>
        <span className="min-w-0 flex-1 truncate text-sm group-hover:text-accent">{course.name}</span>
        <span className="w-16 shrink-0 text-right text-xs text-muted tabular-nums">{course.credits != null ? `${course.credits} cr` : ""}</span>
        <span className="w-24 shrink-0 text-right text-sm tabular-nums">{formatGrade(scale, course.finalGrade)}</span>
        <span className="w-24 shrink-0 text-right">
          <Badge tone={COURSE_TONE[course.status]}>{LABELS.courseStatus[course.status]}</Badge>
        </span>
        <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
      </Link>
    </li>
  );
}

interface StructureProps {
  programme: ProgrammeWithInstitution;
  years: AcademicYear[];
  semesters: Semester[];
  courses: Course[];
}

function Structure({ programme, years, semesters, courses }: StructureProps) {
  const [yearForm, setYearForm] = useState<{ open: boolean; existing?: AcademicYear }>({ open: false });
  const [semesterForm, setSemesterForm] = useState<{ open: boolean; yearId: string; existing?: Semester }>({ open: false, yearId: "" });
  const [courseForm, setCourseForm] = useState<{ open: boolean; semesterId: string | null }>({ open: false, semesterId: null });
  const deleteYear = useConfirmAction((y: AcademicYear) => deleteAcademicYear(y.id));
  const deleteSemester = useConfirmAction((s: Semester) => removeSemester(s.id));

  const scale = programme.gradingScale;
  const unassigned = courses.filter((c) => !c.semesterId || !semesters.some((s) => s.id === c.semesterId));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Structure</h2>
        <div className="flex gap-2">
          <Button size="sm" icon={<CalendarRange className="size-3.5" />} onClick={() => setYearForm({ open: true })}>
            Add year
          </Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCourseForm({ open: true, semesterId: null })}>
            Add course
          </Button>
        </div>
      </div>

      {years.length === 0 && courses.length === 0 && (
        <Card>
          <EmptyState
            icon={<CalendarRange className="size-5" />}
            title="Organise your programme"
            description="Add academic years (e.g. 2026–2027 or Year 1) with semesters or terms, then add courses to them. Courses can also live directly in the programme."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setYearForm({ open: true })}>
                Add academic year
              </Button>
            }
          />
        </Card>
      )}

      {years.map((y) => {
        const yearSemesters = semesters.filter((s) => s.academicYearId === y.id);
        return (
          <Card key={y.id}>
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="font-medium">{y.label}</p>
                {(y.startDate || y.endDate) && <p className="text-xs text-subtle">{formatDateRange(y.startDate, y.endDate)}</p>}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setSemesterForm({ open: true, yearId: y.id })}>
                  Semester
                </Button>
                <IconButton label={`Edit ${y.label}`} onClick={() => setYearForm({ open: true, existing: y })}>
                  <Pencil className="size-3.5" />
                </IconButton>
                <IconButton label={`Delete ${y.label}`} onClick={() => deleteYear.ask(y)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            </div>
            {yearSemesters.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-subtle">No semesters yet.</p>
            ) : (
              yearSemesters.map((s) => {
                const list = courses.filter((c) => c.semesterId === s.id);
                const avg = computeProgrammeStats(list, scale, null).average;
                return (
                  <div key={s.id} className="border-b border-border last:border-b-0">
                    <div className="flex items-center justify-between gap-2 bg-surface-2/50 px-4 py-2">
                      <div className="flex items-baseline gap-2">
                        <p className="text-sm font-medium">{s.label}</p>
                        <p className="text-xs text-subtle">{formatDateRange(s.startDate, s.endDate)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {avg != null && <span className="mr-2 text-xs text-muted">Average {formatGrade(scale, avg)}</span>}
                        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setCourseForm({ open: true, semesterId: s.id })}>
                          Course
                        </Button>
                        <IconButton label={`Edit ${s.label}`} onClick={() => setSemesterForm({ open: true, yearId: y.id, existing: s })}>
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton label={`Delete ${s.label}`} onClick={() => deleteSemester.ask(s)}>
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    </div>
                    {list.length === 0 ? (
                      <p className="px-4 py-3 text-[13px] text-subtle">No courses in this semester.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {list.map((c) => (
                          <CourseRow key={c.id} course={c} scale={scale} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <Card>
          <div className="border-b border-border px-4 py-3">
            <p className="font-medium">Not assigned to a semester</p>
            <p className="text-xs text-subtle">Transfer credits, modules or self-paced courses.</p>
          </div>
          <ul className="divide-y divide-border">
            {unassigned.map((c) => (
              <CourseRow key={c.id} course={c} scale={scale} />
            ))}
          </ul>
        </Card>
      )}

      <PeriodForm
        open={yearForm.open}
        onClose={() => setYearForm({ open: false })}
        target={{ kind: "year", programmeId: programme.id, existing: yearForm.existing }}
      />
      <PeriodForm
        open={semesterForm.open}
        onClose={() => setSemesterForm({ open: false, yearId: "" })}
        target={{ kind: "semester", academicYearId: semesterForm.yearId, existing: semesterForm.existing }}
      />
      <CourseForm
        open={courseForm.open}
        onClose={() => setCourseForm({ open: false, semesterId: null })}
        programme={programme}
        defaultSemesterId={courseForm.semesterId}
      />
      <ConfirmDialog
        open={deleteYear.target != null}
        title="Delete academic year?"
        busy={deleteYear.busy} error={deleteYear.error}
        onClose={deleteYear.cancel}
        onConfirm={deleteYear.confirm}
        message={
          <>
            <p>
              <strong className="text-fg">{deleteYear.target?.label}</strong> and its semesters will be removed. Courses are kept and moved to
              “Not assigned to a semester”.
            </p>
            {deleteYear.error && <p className="mt-2 text-danger">{deleteYear.error}</p>}
          </>
        }
      />
      <ConfirmDialog
        open={deleteSemester.target != null}
        title="Delete semester?"
        busy={deleteSemester.busy} error={deleteSemester.error}
        onClose={deleteSemester.cancel}
        onConfirm={deleteSemester.confirm}
        message={
          <>
            <p>
              <strong className="text-fg">{deleteSemester.target?.label}</strong> will be removed. Its courses are kept and moved to “Not
              assigned to a semester”.
            </p>
            {deleteSemester.error && <p className="mt-2 text-danger">{deleteSemester.error}</p>}
          </>
        }
      />
    </div>
  );
}

export default function ProgrammePage() {
  const { programmeId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const programme = useProgramme(programmeId);
  const years = useAcademicYears(programmeId);
  const semesters = useSemesters(programmeId);
  const courses = useCourses(programmeId);
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const deleteProgramme = useConfirmAction(
    (target: ProgrammeWithInstitution) => removeProgramme(target.id),
    () => navigate("/studies"),
  );

  const queries = [programme, years, semesters, courses];
  if (queries.some((q) => q.isPending)) return <Spinner />;
  const failed = queries.find((q) => q.error);
  if (failed) return <ErrorState error={failed.error} onRetry={() => queries.forEach((q) => void q.refetch())} />;
  const p = programme.data;
  if (!p)
    return (
      <EmptyState
        icon={<BookOpen className="size-5" />}
        title="Programme not found"
        description="It may have been deleted."
        action={<Button onClick={() => navigate("/studies")}>Back to My Studies</Button>}
      />
    );

  const stats = computeProgrammeStats(courses.data ?? [], p.gradingScale, p.totalCredits);
  const isActive = settings.data?.activeProgrammeId === p.id;
  const makeActive = async () => {
    await setSetting("activeProgrammeId", p.id);
    await client.invalidateQueries();
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/studies" className="hover:text-fg">
            My Studies
          </Link>
        }
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {p.institutionName} · {LABELS.programmeLevel[p.level]}
            {p.field ? ` · ${p.field}` : ""}
            {(p.startDate || p.endDate) && ` · ${formatDateRange(p.startDate, p.endDate)}`}
            <Badge tone={p.status === "active" ? "accent" : "neutral"}>{LABELS.programmeStatus[p.status]}</Badge>
          </span>
        }
        actions={
          <>
            <ExportMenu items={programmeExports(p.id, p.name)} />
            {isActive ? (
              <Badge tone="accent">
                <CheckCircle2 className="mr-1 size-3" /> Current programme
              </Badge>
            ) : (
              <Button size="sm" onClick={() => void makeActive()}>
                Set as current
              </Button>
            )}
            <IconButton label="Edit programme" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete programme" onClick={() => deleteProgramme.ask(p)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <Card className="mb-6 grid grid-cols-4 gap-6 p-5">
        <Stat
          label="Average"
          value={formatGrade(p.gradingScale, stats.average)}
          sub={p.targetGrade != null ? `Target ${formatGrade(p.gradingScale, p.targetGrade)}` : "No target set"}
        />
        <Stat
          label={`${p.creditUnit} earned`}
          value={p.totalCredits ? `${stats.earnedCredits} / ${p.totalCredits}` : stats.earnedCredits}
          sub={`${stats.gradedCredits} graded`}
        />
        <Stat label="Courses" value={stats.courseCount} sub={`${stats.completedCount} completed · ${stats.inProgressCount} in progress`} />
        <div className="flex flex-col justify-center gap-2">
          <span className="text-xs text-muted">Progress</span>
          {stats.progress != null ? (
            <>
              <span className="text-xl font-semibold tabular-nums">{Math.round(stats.progress * 100)}%</span>
              <ProgressBar value={stats.progress} label="Programme progress" />
            </>
          ) : (
            <span className="text-xs text-subtle">Set the credits required to track progress.</span>
          )}
        </div>
      </Card>

      <Structure programme={p} years={years.data ?? []} semesters={semesters.data ?? []} courses={courses.data ?? []} />

      <ProgrammeForm open={editing} programme={p} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={deleteProgramme.target != null}
        title="Delete programme?"
        busy={deleteProgramme.busy} error={deleteProgramme.error}
        onClose={deleteProgramme.cancel}
        onConfirm={deleteProgramme.confirm}
        message={
          <>
            <p>
              <strong className="text-fg">{p.name}</strong> with all its years, semesters and {stats.courseCount} course(s) will be removed.
            </p>
            {deleteProgramme.error && <p className="mt-2 text-danger">{deleteProgramme.error}</p>}
          </>
        }
      />
    </>
  );
}
