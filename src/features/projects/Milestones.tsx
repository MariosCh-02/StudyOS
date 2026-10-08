import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Check, Flag, Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Feedback";
import { useMilestones } from "@/hooks/queries";
import { formatDate, toDateKey } from "@/domain/dates";
import { addMilestone, deleteMilestone, moveMilestone, setMilestoneDone, updateMilestone, type Milestone } from "@/services/projects";

const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none";

function MilestoneRow({ m, first, last, onError }: { m: Milestone; first: boolean; last: boolean; onError: (e: string) => void }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [due, setDue] = useState(m.dueDate ?? "");
  const today = toDateKey(new Date());
  const overdue = !m.doneAt && m.dueDate != null && m.dueDate < today;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await client.invalidateQueries();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await updateMilestone(m.id, title, due || null);
      setEditing(false);
    });
  };

  if (editing) {
    return (
      <li className="px-4 py-2">
        <form onSubmit={submit} className="flex items-center gap-2">
          <input aria-label="Milestone" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={clsx(input, "min-w-0 flex-1")} />
          <input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
          <IconButton label="Save milestone" type="submit">
            <Check className="size-4" />
          </IconButton>
        </form>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-3 px-4 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={m.doneAt != null}
        aria-label={m.doneAt ? `Mark "${m.title}" as not done` : `Mark "${m.title}" as done`}
        onClick={() => void run(() => setMilestoneDone(m.id, !m.doneAt))}
        className={clsx(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          m.doneAt ? "border-success bg-success text-white" : "border-border hover:border-accent",
        )}
      >
        {m.doneAt && <Check className="size-3" />}
      </button>
      <span className={clsx("min-w-0 flex-1 truncate text-sm", m.doneAt && "text-subtle line-through")}>{m.title}</span>
      {m.dueDate && <span className={clsx("shrink-0 text-xs tabular-nums", overdue ? "text-danger" : "text-muted")}>{formatDate(m.dueDate, { day: "numeric", month: "short" })}</span>}
      <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <IconButton label="Move up" disabled={first} onClick={() => void run(() => moveMilestone(m.projectId, m.id, -1))} className="size-7">
          <ArrowUp className="size-3.5" />
        </IconButton>
        <IconButton label="Move down" disabled={last} onClick={() => void run(() => moveMilestone(m.projectId, m.id, 1))} className="size-7">
          <ArrowDown className="size-3.5" />
        </IconButton>
        <IconButton label="Edit milestone" onClick={() => setEditing(true)} className="size-7">
          <Pencil className="size-3.5" />
        </IconButton>
        <IconButton label="Delete milestone" onClick={() => void run(() => deleteMilestone(m.id))} className="size-7">
          <Trash2 className="size-3.5" />
        </IconButton>
      </span>
    </li>
  );
}

export function MilestonesCard({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const milestones = useMilestones(projectId);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = milestones.data ?? [];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || adding) return;
    setAdding(true);
    setError(null);
    try {
      await addMilestone(projectId, title, due || null);
      setTitle("");
      setDue("");
      await client.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Milestones" icon={<Flag className="size-3.5" />} action={list.length > 0 && <span className="text-xs text-muted">{list.filter((m) => m.doneAt).length} / {list.length} done</span>} />
      {list.length > 0 && (
        <ul className="divide-y divide-border border-b border-border">
          {list.map((m, i) => (
            <MilestoneRow key={m.id} m={m} first={i === 0} last={i === list.length - 1} onError={setError} />
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} className="flex items-center gap-2 px-4 py-3">
        <input aria-label="New milestone" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a milestone (e.g. Literature review done)" className={clsx(input, "min-w-0 flex-1")} />
        <input aria-label="Milestone due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
        <button type="submit" disabled={!title.trim() || adding} className="h-8 rounded-md bg-surface-2 px-3 text-[13px] hover:bg-border/60 disabled:opacity-50">
          Add
        </button>
      </form>
      {error && <p className="px-4 pb-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}
