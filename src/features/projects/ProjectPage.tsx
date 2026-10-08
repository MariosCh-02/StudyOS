import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  BookOpen,
  CalendarClock,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  Library,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, ErrorState, ProgressBar, Spinner, Stat } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/Field";
import { Markdown } from "@/components/Markdown";
import { useMilestones, usePapers, useProject, useProjectNotes, useTasks } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { openExternal } from "@/lib/links";
import { projectProgress } from "@/domain/research";
import { formatDate, toDateKey } from "@/domain/dates";
import {
  createProjectNote,
  deleteProject,
  getOrCreateSectionNote,
  MULTI_SECTIONS,
  PROJECT_LABELS,
  PROJECT_STATUSES,
  RESEARCH_KINDS,
  SECTION_META,
  setProjectStatus,
  SINGLE_SECTIONS,
  type Project,
  type ProjectNote,
  type ProjectStatus,
  type WorkspaceSection,
} from "@/services/projects";
import { addPaperToProject, removePaperFromProject } from "@/services/papers";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { ConceptsCard } from "@/features/knowledge/KnowledgePages";
import { TaskForm } from "@/features/tasks/TaskForm";
import { TaskList } from "@/features/tasks/TaskList";
import { relativeTime } from "@/features/notes/NoteList";
import { PaperForm } from "@/features/papers/PaperForm";
import { AddFromLibraryDialog, BibtexImportDialog, exportBib, PaperRow, referenceList } from "@/features/papers/PaperParts";
import { ProjectForm } from "./ProjectForm";
import { MilestonesCard } from "./Milestones";
import { ExportMenu } from "@/components/ExportMenu";
import { projectExports } from "@/features/export/exportItems";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "workspace", label: "Notes", icon: NotebookPen },
  { id: "papers", label: "Literature", icon: Library },
  { id: "files", label: "Files", icon: FolderOpen },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Opens (creating if needed) a workspace note and navigates to it. */
function useOpenNote(projectId: string) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async (key: string, make: () => Promise<{ id: string }>) => {
    setBusy(key);
    setError(null);
    try {
      const note = await make();
      await client.invalidateQueries({ queryKey: ["projectNotes", projectId] });
      navigate(`/notes/${note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };
  return { busy, error, open };
}

function NoteLine({ n }: { n: ProjectNote }) {
  return (
    <li>
      <Link to={`/notes/${n.id}`} className="block px-4 py-2 hover:bg-surface-2">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm">{n.title || "Untitled note"}</span>
          <span className="shrink-0 text-xs text-subtle">{relativeTime(n.updatedAt)}</span>
        </span>
        {n.snippet.trim() && <span className="line-clamp-1 text-xs text-muted">{n.snippet}</span>}
      </Link>
    </li>
  );
}

function WorkspaceTab({ project }: { project: Project }) {
  const notes = useProjectNotes(project.id);
  const { busy, error, open } = useOpenNote(project.id);
  const research = RESEARCH_KINDS.includes(project.kind);
  const all = notes.data ?? [];
  const bySection = (s: WorkspaceSection | null) => all.filter((n) => n.section === s);

  if (notes.isPending) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {research && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Research workspace</h2>
          <div className="grid grid-cols-2 gap-4">
            {SINGLE_SECTIONS.map((s) => {
              const note = bySection(s)[0];
              const meta = SECTION_META[s];
              return (
                <Card key={s} className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{meta.label}</h3>
                    {note && <span className="text-xs text-subtle">{relativeTime(note.updatedAt)}</span>}
                  </div>
                  <p className="line-clamp-3 flex-1 text-xs text-muted">{note?.snippet.trim() || meta.hint}</p>
                  <Button size="sm" className="w-fit" loading={busy === s} onClick={() => void open(s, () => getOrCreateSectionNote(project.id, s))}>
                    {note ? "Open" : "Start writing"}
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      )}
      <div className="grid grid-cols-3 items-start gap-4">
        {MULTI_SECTIONS.map((s) => {
          const list = bySection(s);
          const meta = SECTION_META[s];
          return (
            <Card key={s}>
              <CardHeader
                title={meta.label}
                action={
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} loading={busy === s} onClick={() => void open(s, () => createProjectNote(project.id, s, s === "meeting" ? `Meeting ${formatDate(toDateKey(new Date()))}` : s === "experiment" ? `Experiment ${list.length + 1}` : undefined))}>
                    New
                  </Button>
                }
              />
              {list.length === 0 ? <p className="px-4 pb-4 text-[13px] text-subtle">{meta.hint}</p> : <ul className="divide-y divide-border pb-1">{list.map((n) => <NoteLine key={n.id} n={n} />)}</ul>}
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader
          title="Other notes"
          action={
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} loading={busy === "other"} onClick={() => void open("other", () => createProjectNote(project.id, null))}>
              New note
            </Button>
          }
        />
        {bySection(null).length === 0 ? <p className="px-4 pb-4 text-[13px] text-subtle">Anything else: ideas, design decisions, retrospectives.</p> : <ul className="divide-y divide-border pb-1">{bySection(null).map((n) => <NoteLine key={n.id} n={n} />)}</ul>}
      </Card>
    </div>
  );
}

function LiteratureTab({ project }: { project: Project }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const papers = usePapers({ projectId: project.id });
  const [adding, setAdding] = useState<"library" | "new" | "bib" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const list = papers.data ?? [];
  const existing = useMemo(() => new Set(list.map((p) => p.id)), [list]);
  const read = list.filter((p) => p.status === "read").length;

  const copyRefs = async () => {
    await navigator.clipboard.writeText(referenceList(list).plain);
    setMessage({ text: `Copied ${list.length} APA references.`, error: false });
  };
  const exportRefs = async () => {
    setMessage(null);
    try {
      if (await exportBib(list, `${project.title.replace(/[^\w-]+/g, "-").toLowerCase() || "project"}.bib`)) setMessage({ text: "BibTeX file saved.", error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    }
  };
  const remove = async (paperId: string) => {
    await removePaperFromProject(project.id, paperId);
    await client.invalidateQueries();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted">{list.length ? `${list.length} papers · ${read} read` : "Papers you read and cite for this project."}</p>
        <Button size="sm" icon={<Library className="size-3.5" />} onClick={() => setAdding("library")}>
          From library
        </Button>
        <Button size="sm" icon={<FileUp className="size-3.5" />} onClick={() => setAdding("bib")}>
          Import BibTeX
        </Button>
        <Button size="sm" icon={<Copy className="size-3.5" />} disabled={!list.length} onClick={() => void copyRefs()}>
          Copy references
        </Button>
        <Button size="sm" icon={<Download className="size-3.5" />} disabled={!list.length} onClick={() => void exportRefs()}>
          Export .bib
        </Button>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding("new")}>
          Add paper
        </Button>
      </div>
      {message && <p className={clsx("rounded-md px-3 py-2 text-sm", message.error ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>{message.text}</p>}
      <Card>
        {papers.isPending ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState icon={<FileText className="size-5" />} title="No papers yet" description="Add papers by DOI, from your library, or import a .bib file." />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((p) => (
              <PaperRow
                key={p.id}
                paper={p}
                action={
                  <IconButton label={`Remove "${p.title}" from this project`} onClick={() => void remove(p.id)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                    <X className="size-3.5" />
                  </IconButton>
                }
              />
            ))}
          </ul>
        )}
      </Card>
      {list.length > 0 && (
        <Card>
          <CardHeader title="Reference list (APA 7)" />
          <Markdown source={referenceList(list).markdown} className="px-4 pb-4 text-sm [&_p]:pl-6 [&_p]:-indent-6" />
        </Card>
      )}
      <AddFromLibraryDialog open={adding === "library"} onClose={() => setAdding(null)} projectId={project.id} existing={existing} />
      <BibtexImportDialog open={adding === "bib"} onClose={() => setAdding(null)} projectId={project.id} />
      <PaperForm
        open={adding === "new"}
        onClose={() => setAdding(null)}
        onSaved={(p) => {
          void addPaperToProject(project.id, p.id)
            .then(() => client.invalidateQueries())
            .then(() => navigate(`/papers/${p.id}`));
        }}
      />
    </div>
  );
}

function OverviewTab({ project: p }: { project: Project }) {
  const research = RESEARCH_KINDS.includes(p.kind);
  return (
    <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
      <div className="flex flex-col gap-5">
        {research && p.researchQuestion && (
          <Card className="border-l-4 border-l-accent p-4">
            <p className="mb-1 text-xs font-medium text-muted">Research question</p>
            <p className="text-sm">{p.researchQuestion}</p>
          </Card>
        )}
        <MilestonesCard projectId={p.id} />
        {p.description && (
          <Card>
            <CardHeader title="Description" />
            <Markdown source={p.description} className="px-4 pb-4 text-sm" />
          </Card>
        )}
      </div>
      <div className="flex flex-col gap-5">
        {p.lessonId && (
          <Card className="p-4">
            <p className="mb-2 text-xs text-muted">Guided project from your learning track</p>
            <Link to={`/practice/lessons/${p.lessonId}`} className="flex items-center gap-1.5 text-sm text-accent hover:underline">
              <BookOpen className="size-4" aria-hidden /> Open the project brief and hints
            </Link>
          </Card>
        )}
        {p.links.length > 0 && (
          <Card>
            <CardHeader title="Links" />
            <ul className="flex flex-col gap-1 px-4 pb-4">
              {p.links.map((l, i) => (
                <li key={i}>
                  <button type="button" onClick={() => void openExternal(l.url)} className="flex max-w-full items-center gap-1.5 text-sm text-accent hover:underline">
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{l.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {p.members.length > 0 && (
          <Card>
            <CardHeader title="Team" icon={<Users className="size-3.5" />} />
            <ul className="flex flex-col gap-2 px-4 pb-4">
              {p.members.map((m, i) => (
                <li key={i} className="text-sm">
                  <span className="block">{m.name}</span>
                  <span className="text-xs text-muted">
                    {[m.role, m.email].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <ConceptsCard type="project" id={p.id} />
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some((t) => t.id === params.get("tab")) ? (params.get("tab") as TabId) : "overview";
  const project = useProject(projectId);
  const milestones = useMilestones(projectId);
  const tasks = useTasks({ projectId });
  const [editing, setEditing] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const remove = useConfirmAction((p: Project) => deleteProject(p.id), () => navigate("/projects"));
  const p = project.data;
  const taskDefaults = useMemo(() => (p ? { projectId: p.id, courseId: p.courseId } : undefined), [p?.id, p?.courseId]);

  if (project.isPending) return <Spinner />;
  if (project.error) return <ErrorState error={project.error} />;
  if (!p) return <EmptyState icon={<FolderKanban className="size-5" />} title="Project not found" action={<Button onClick={() => navigate("/projects")}>Back to Projects</Button>} />;

  const ms = milestones.data ?? [];
  const ts = tasks.data ?? [];
  const progress = projectProgress(
    ms.map((m) => ({ done: m.doneAt != null })),
    ts.map((t) => ({ done: t.status === "done" })),
  );
  const today = toDateKey(new Date());
  const daysLeft = p.dueDate ? Math.round((new Date(`${p.dueDate}T00:00`).getTime() - new Date(`${today}T00:00`).getTime()) / 86_400_000) : null;
  const research = RESEARCH_KINDS.includes(p.kind);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link to="/projects" className="hover:text-fg">
              Projects
            </Link>
            {p.courseId && (
              <>
                /
                <Link to={`/studies/courses/${p.courseId}`} className="hover:text-fg">
                  {p.courseCode ?? p.courseName}
                </Link>
              </>
            )}
          </span>
        }
        title={p.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {PROJECT_LABELS.kind[p.kind]}
            {p.dueDate && (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden /> Due {formatDate(p.dueDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <SelectField
              label="Status"
              className="w-36 [&_label]:sr-only"
              value={p.status}
              onChange={(e) => void setProjectStatus(p.id, e.target.value as ProjectStatus).then(() => client.invalidateQueries())}
              options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_LABELS.status[s] }))}
            />
            <ExportMenu items={projectExports(p.id)} />
            <IconButton label="Edit project" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete project" onClick={() => remove.ask(p)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <Card className="mb-5 grid grid-cols-3 gap-6 p-5">
        <div className="flex flex-col justify-center gap-2">
          <span className="text-xs text-muted">Progress</span>
          <span className="text-xl font-semibold tabular-nums">{progress.ratio != null ? `${Math.round(progress.ratio * 100)}%` : "—"}</span>
          {progress.ratio != null && <ProgressBar value={progress.ratio} label="Project progress" />}
        </div>
        <Stat label="Milestones and tasks" value={`${progress.done} / ${progress.total}`} sub="done" />
        <Stat
          label="Time left"
          value={p.status === "completed" || p.status === "cancelled" ? PROJECT_LABELS.status[p.status] : daysLeft == null ? "—" : daysLeft < 0 ? `${-daysLeft} d late` : daysLeft === 0 ? "Due today" : `${daysLeft} d`}
          sub={p.dueDate ? (p.startDate ? `${formatDate(p.startDate)} – ${formatDate(p.dueDate)}` : `until ${formatDate(p.dueDate)}`) : "No due date"}
        />
      </Card>

      <div role="tablist" aria-label="Project sections" className="mb-5 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === "overview" ? {} : { tab: t.id }, { replace: true })}
            className={clsx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.id === "workspace" && research ? <FlaskConical className="size-4" aria-hidden /> : <t.icon className="size-4" aria-hidden />}
            {t.id === "workspace" && research ? "Research" : t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab project={p} />}
      {tab === "tasks" && (
        <Card>
          <CardHeader
            title="Tasks"
            action={
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingTask(true)}>
                Add task
              </Button>
            }
          />
          {tasks.isPending ? <Spinner /> : ts.length === 0 ? <p className="px-4 pb-4 text-[13px] text-subtle">Break milestones into tasks with due dates and estimates; they also appear on your Tasks page.</p> : <TaskList tasks={ts} />}
        </Card>
      )}
      {tab === "workspace" && <WorkspaceTab project={p} />}
      {tab === "papers" && <LiteratureTab project={p} />}
      {tab === "files" && (
        <Card>
          <CardHeader title="Files" />
          <div className="px-2 pb-2">
            <AttachmentList owner={{ type: "project", id: p.id }} onView={(f) => navigate(`/files/${f.id}`)} />
          </div>
        </Card>
      )}

      <ProjectForm open={editing} onClose={() => setEditing(false)} project={p} />
      <TaskForm open={addingTask} onClose={() => setAddingTask(false)} defaults={taskDefaults} />
      <ConfirmDialog
        open={remove.target != null}
        title="Delete project?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={<p>“{p.title}” with its milestones, notes and files will be removed. Its tasks are kept, and papers stay in your library.</p>}
      />
    </>
  );
}
