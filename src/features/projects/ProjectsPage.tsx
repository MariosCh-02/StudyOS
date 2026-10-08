import { useState } from "react";
import { Link, useNavigate } from "react-router";
import clsx from "clsx";
import { CalendarClock, FileText, FolderKanban, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState, ErrorState, ProgressBar, Spinner } from "@/components/ui/Feedback";
import { useProjects } from "@/hooks/queries";
import { formatDate, toDateKey } from "@/domain/dates";
import { PROJECT_LABELS, type ProjectStatus, type ProjectSummary } from "@/services/projects";
import { ProjectForm } from "./ProjectForm";

export const STATUS_TONE: Record<ProjectStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  planning: "neutral",
  active: "accent",
  on_hold: "warning",
  completed: "success",
  cancelled: "neutral",
};

const FILTERS: { id: ProjectStatus | "open" | "all"; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All" },
];

export function ProjectCard({ p }: { p: ProjectSummary }) {
  const today = toDateKey(new Date());
  const overdue = p.dueDate != null && p.dueDate < today && (p.status === "active" || p.status === "planning");
  return (
    <Link to={`/projects/${p.id}`} className="block">
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-accent">
        <div className="flex items-start gap-2">
          <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: p.courseColor ?? "var(--accent)" }} aria-hidden />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{p.title}</h3>
            <p className="truncate text-xs text-muted">
              {PROJECT_LABELS.kind[p.kind]}
              {p.courseName && ` · ${p.courseCode ?? p.courseName}`}
            </p>
          </div>
          <Badge tone={STATUS_TONE[p.status]}>{PROJECT_LABELS.status[p.status]}</Badge>
        </div>
        {p.progress.ratio != null ? (
          <div className="flex items-center gap-2">
            <ProgressBar value={p.progress.ratio} label={`${p.title} progress`} />
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {p.progress.done}/{p.progress.total}
            </span>
          </div>
        ) : (
          <p className="text-xs text-subtle">No milestones or tasks yet</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {p.nextMilestone && <span className="min-w-0 truncate">Next: {p.nextMilestone.title}</span>}
          {p.dueDate && (
            <span className={clsx("flex items-center gap-1", overdue && "text-danger")}>
              <CalendarClock className="size-3.5" aria-hidden /> Due {formatDate(p.dueDate, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
          {p.paperCount > 0 && (
            <span className="flex items-center gap-1">
              <FileText className="size-3.5" aria-hidden /> {p.paperCount} {p.paperCount === 1 ? "paper" : "papers"}
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const projects = useProjects(filter === "all" ? {} : { status: filter });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="AI and programming projects, group work, research and your thesis: milestones, tasks, notes, files and literature in one place."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      <div role="tablist" aria-label="Filter projects" className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            type="button"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={clsx("rounded-full px-3 py-1 text-sm", filter === f.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-fg")}
          >
            {f.label}
          </button>
        ))}
      </div>
      {projects.isPending ? (
        <Spinner />
      ) : projects.error ? (
        <ErrorState error={projects.error} />
      ) : (projects.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title={filter === "open" ? "No open projects" : "No projects here"}
            description="Create a project, or start one of the guided AI projects from Practice → AI Projects."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New project
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
          {projects.data!.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <ProjectForm open={creating} onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />
    </>
  );
}
