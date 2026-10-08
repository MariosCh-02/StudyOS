import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, FileUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/Field";
import { useAllCourses } from "@/hooks/queries";
import { EVENT_TYPE_META } from "@/domain/conflicts";
import { formatDateRange } from "@/domain/dates";
import { pickIcsFile, readTextFile } from "@/lib/native";
import { importIcs, previewIcs, type ImportPreview, type ImportResult } from "@/services/icsTransfer";
import type { RecurringType } from "@/services/calendar";

const TYPES: RecurringType[] = ["class", "work", "study", "internship", "research", "personal", "other"];

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const courses = useAllCourses();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [type, setType] = useState<RecurringType>("class");
  const [courseId, setCourseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }, [open]);

  const choose = async () => {
    setError(null);
    try {
      const path = await pickIcsFile();
      if (!path) return;
      const text = await readTextFile(path);
      const p = previewIcs(text);
      if (p.total === 0) {
        setError(p.warnings[0] ?? "No events found in this file.");
        return;
      }
      setFile({ name: path.split(/[\\/]/).pop() ?? path, text });
      setPreview(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importIcs(file.text, { type, courseId: courseId || null }));
      await client.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import calendar (.ics)"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!preview} loading={busy} onClick={() => void runImport()}>
              Import
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {result ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CalendarCheck2 className="size-8 text-success" aria-hidden />
            <p className="font-medium">Import complete</p>
            <p className="text-muted">
              {result.created} added · {result.updated} updated{result.skipped ? ` · ${result.skipped} cancelled events skipped` : ""}
            </p>
            {result.warnings.length > 0 && (
              <ul className="mt-2 w-full rounded-md bg-warning-soft px-3 py-2 text-left text-xs text-warning">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <p className="text-muted">
              Import a timetable or calendar exported from your university portal, Google Calendar or Outlook. Weekly repeats become timetable entries.
              Importing the same file again updates it instead of creating duplicates.
            </p>
            <Button icon={<FileUp className="size-4" />} onClick={() => void choose()} className="self-start">
              {file ? "Choose a different file" : "Choose .ics file"}
            </Button>
            {file && preview && (
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">{file.name}</p>
                <p className="mt-1 text-muted">
                  {preview.recurring} repeating · {preview.single} single{preview.overrides ? ` · ${preview.overrides} changed sessions` : ""}
                  {preview.cancelled ? ` · ${preview.cancelled} cancelled` : ""}
                  {preview.firstDate && ` · ${formatDateRange(preview.firstDate, preview.lastDate)}`}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <SelectField
                    label="Import as"
                    value={type}
                    onChange={(e) => setType(e.target.value as RecurringType)}
                    options={TYPES.map((t) => ({ value: t, label: `${EVENT_TYPE_META[t].emoji} ${EVENT_TYPE_META[t].label}` }))}
                  />
                  <SelectField
                    label="Link to course (optional)"
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]}
                    hint="Use when the file contains one course's sessions."
                  />
                </div>
                {preview.warnings.length > 0 && (
                  <ul className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                    {preview.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
