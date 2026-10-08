import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Card, EmptyState, ErrorState, ProgressBar, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useInstitutions, useProgrammeSummaries, useSettings } from "@/hooks/queries";
import { LABELS, type Institution, type ProgrammeStatus } from "@/domain/types";
import { formatGrade } from "@/domain/grading";
import { formatDateRange } from "@/domain/dates";
import type { ProgrammeSummary } from "@/services/dashboard";
import { deleteInstitution } from "@/services/institutions";
import { InstitutionForm } from "./InstitutionForm";
import { ProgrammeForm } from "./ProgrammeForm";

const GROUPS: { title: string; statuses: ProgrammeStatus[] }[] = [
  { title: "Active", statuses: ["active"] },
  { title: "Future", statuses: ["planned"] },
  { title: "Paused", statuses: ["paused"] },
  { title: "Completed", statuses: ["completed"] },
  { title: "Withdrawn", statuses: ["withdrawn"] },
];

const STATUS_TONE = { active: "accent", planned: "warning", paused: "neutral", completed: "success", withdrawn: "neutral" } as const;

function ProgrammeCard({ summary, isActive }: { summary: ProgrammeSummary; isActive: boolean }) {
  const { programme: p, stats } = summary;
  return (
    <Link
      to={`/studies/programmes/${p.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 size-2.5 shrink-0 rounded-full" style={{ background: p.color ?? "var(--accent)" }} />
          <div className="min-w-0">
            <p className="truncate font-medium group-hover:text-accent">{p.name}</p>
            <p className="truncate text-[13px] text-muted">
              {p.institutionName} · {LABELS.programmeLevel[p.level]}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {isActive && <Badge tone="accent">Current</Badge>}
          <Badge tone={STATUS_TONE[p.status]}>{LABELS.programmeStatus[p.status]}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-[13px]">
        <div>
          <p className="text-xs text-subtle">Average</p>
          <p className="font-medium tabular-nums">{formatGrade(p.gradingScale, stats.average)}</p>
        </div>
        <div>
          <p className="text-xs text-subtle">Courses</p>
          <p className="font-medium tabular-nums">{stats.courseCount}</p>
        </div>
        <div>
          <p className="text-xs text-subtle">{p.creditUnit}</p>
          <p className="font-medium tabular-nums">
            {stats.earnedCredits}
            {p.totalCredits ? ` / ${p.totalCredits}` : ""}
          </p>
        </div>
      </div>
      {stats.progress != null && <ProgressBar value={stats.progress} label={`${p.name} progress`} />}
      {(p.startDate || p.endDate) && <p className="text-xs text-subtle">{formatDateRange(p.startDate, p.endDate)}</p>}
    </Link>
  );
}

function InstitutionsPanel({ institutions, summaries }: { institutions: Institution[]; summaries: ProgrammeSummary[] }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<Institution | null>(null);
  const [deleting, setDeleting] = useState<Institution | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await deleteInstitution(deleting.id);
      await client.invalidateQueries();
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const programmeCount = (id: string) => summaries.filter((s) => s.programme.institutionId === id).length;

  return (
    <Card>
      <div className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">Institutions</div>
      <ul className="divide-y divide-border">
        {institutions.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">{i.name}</p>
              <p className="text-xs text-subtle">
                {LABELS.institutionKind[i.kind]}
                {i.country ? ` · ${i.country}` : ""} · {programmeCount(i.id)} programme{programmeCount(i.id) === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0">
              <IconButton label={`Edit ${i.name}`} onClick={() => setEditing(i)}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton label={`Delete ${i.name}`} onClick={() => setDeleting(i)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
      <InstitutionForm open={!!editing} institution={editing ?? undefined} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete institution?"
        busy={busy}
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={() => void confirmDelete()}
        message={
          <>
            <p>
              <strong className="text-fg">{deleting?.name}</strong> and its {deleting ? programmeCount(deleting.id) : 0} programme(s),
              including all years, semesters and courses, will be removed.
            </p>
            {error && <p className="mt-2 text-danger">{error}</p>}
          </>
        }
      />
    </Card>
  );
}

export default function StudiesPage() {
  const summaries = useProgrammeSummaries();
  const institutions = useInstitutions();
  const settings = useSettings();
  const [newInstitution, setNewInstitution] = useState(false);
  const [newProgramme, setNewProgramme] = useState(false);

  if (summaries.isPending || institutions.isPending) return <Spinner />;
  if (summaries.error || institutions.error)
    return (
      <ErrorState
        error={summaries.error ?? institutions.error}
        onRetry={() => {
          void summaries.refetch();
          void institutions.refetch();
        }}
      />
    );

  const hasInstitutions = institutions.data.length > 0;
  const activeId = settings.data?.activeProgrammeId;

  return (
    <>
      <PageHeader
        title="My Studies"
        subtitle="Institutions, programmes, years, semesters and courses."
        actions={
          <>
            <Button icon={<Building2 className="size-4" />} onClick={() => setNewInstitution(true)}>
              New institution
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewProgramme(true)} disabled={!hasInstitutions}>
              New programme
            </Button>
          </>
        }
      />

      {!hasInstitutions ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="Start with where you study"
            description="Add your university, college, school, online provider or certification body. You can add as many as you need."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewInstitution(true)}>
                Add institution
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[1fr_18rem] items-start gap-6">
          <div className="flex flex-col gap-6">
            {summaries.data.length === 0 && (
              <Card>
                <EmptyState
                  icon={<GraduationCap className="size-5" />}
                  title="Add your first programme"
                  description="A programme is a degree, diploma, certification or self-learning track, e.g. MSc Artificial Intelligence or BSc Law."
                  action={
                    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewProgramme(true)}>
                      Add programme
                    </Button>
                  }
                />
              </Card>
            )}
            {GROUPS.map((g) => {
              const items = summaries.data.filter((s) => g.statuses.includes(s.programme.status));
              if (items.length === 0) return null;
              return (
                <section key={g.title}>
                  <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">{g.title}</h2>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {items.map((s) => (
                      <ProgrammeCard key={s.programme.id} summary={s} isActive={s.programme.id === activeId} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <InstitutionsPanel institutions={institutions.data} summaries={summaries.data} />
        </div>
      )}

      <InstitutionForm open={newInstitution} onClose={() => setNewInstitution(false)} />
      <ProgrammeForm open={newProgramme} onClose={() => setNewProgramme(false)} />
    </>
  );
}
