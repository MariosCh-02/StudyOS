import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Feedback";
import { TextField } from "@/components/ui/Field";
import { useProjectForLesson } from "@/hooks/queries";
import { toDateKey } from "@/domain/dates";
import { startProjectFromLesson } from "@/services/projects";

/**
 * Shown on guided-project lessons (those with a "## Milestones" list):
 * turns the lesson into a tracked project with one milestone per step.
 */
export function StartProjectCard({ lessonId, milestoneCount }: { lessonId: string; milestoneCount: number }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const existing = useProjectForLesson(lessonId);
  const [start, setStart] = useState(() => toDateKey(new Date()));
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (existing.isPending) return null;

  if (existing.data) {
    return (
      <Card>
        <CardHeader title="Your project" icon={<FolderKanban className="size-3.5" />} />
        <div className="px-4 pb-4">
          <p className="mb-3 text-[13px] text-muted">You started this project. Track milestones, tasks, notes and files there.</p>
          <Link to={`/projects/${existing.data.id}`} className="text-sm text-accent hover:underline">
            Open “{existing.data.title}”
          </Link>
        </div>
      </Card>
    );
  }

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await startProjectFromLesson(lessonId, { startDate: start, dueDate: due || null });
      await client.invalidateQueries();
      navigate(`/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Do this project" icon={<Rocket className="size-3.5" />} />
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[13px] text-muted">Creates a project with {milestoneCount} milestones from this brief. With a due date, milestone dates are spread evenly until then.</p>
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField label="Due (optional)" type="date" value={due} min={start} onChange={(e) => setDue(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button variant="primary" className="w-full" loading={busy} disabled={!start} onClick={() => void go()}>
          Start this project
        </Button>
      </div>
    </Card>
  );
}
