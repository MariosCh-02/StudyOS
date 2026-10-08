import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Markdown } from "@/components/Markdown";
import { aiExamPlan, type AiResult } from "@/services/ai";
import { createNote } from "@/services/notes";
import type { Exam } from "@/services/assessments";
import { AiBadge, AiError, AiLoading, labelledNodes, TruncatedWarning, useAiRun } from "./AiParts";

/**
 * AI revision plan for an exam: sends the exam's topic checklist, course
 * mastery and upcoming deadlines (no notes) and saves the plan as a note.
 */
export function AiPlanDialog({ open, onClose, exam }: { open: boolean; onClose: () => void; exam: Exam }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const run = useAiRun<AiResult>();
  const [hours, setHours] = useState("8");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      run.reset();
      setError(null);
    }
  }, [open]);

  const generate = () => {
    const h = Number(hours);
    void run.start(() => aiExamPlan(exam.id, { hoursPerWeek: Number.isFinite(h) && h > 0 ? h : null, notes }));
  };

  const save = async () => {
    if (run.state.status !== "done") return;
    setSaving(true);
    setError(null);
    try {
      const r = run.state.value;
      const title = `Revision plan — ${exam.title}`;
      const note = await createNote({ courseId: exam.courseId, title, doc: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, ...labelledNodes(r.label, r.text)] } });
      await client.invalidateQueries();
      navigate(`/notes/${note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const s = run.state;
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title="AI revision plan"
      footer={
        s.status === "done" ? (
          <>
            <Button variant="ghost" onClick={generate}>
              Regenerate
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save as note
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={s.status === "loading"} onClick={generate}>
              Create plan
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {s.status === "done" ? (
          <>
            <AiBadge label={s.value.label} />
            {s.value.truncated && <TruncatedWarning />}
            <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border p-3">
              <Markdown source={s.value.text} className="text-sm" />
            </div>
          </>
        ) : s.status === "loading" ? (
          <AiLoading what="Planning" />
        ) : (
          <>
            <p className="text-sm text-muted">
              Sent to your AI provider: the exam date, its topic checklist, your mastery of this course's topics and other open deadlines. Your notes are not sent. For a plan made without AI, use <strong>Plan revision</strong>.
            </p>
            <TextField label="Hours per week for this exam" inputMode="numeric" className="w-56" value={hours} onChange={(e) => setHours(e.target.value)} />
            <TextAreaField label="Anything else? (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. I work Tuesdays and Thursdays; past papers are the best practice for this lecturer." />
            {s.status === "error" && <AiError message={s.message} />}
          </>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
