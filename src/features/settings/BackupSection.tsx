import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FolderOpen, HardDriveDownload, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/Field";
import { qk } from "@/hooks/queries";
import { backupDelete, backupList, backupOpenFolder, isTauri, pickBackupFile, type BackupInfo } from "@/lib/native";
import { saveTextFile } from "@/lib/saveFile";
import { formatBytes } from "@/services/attachments";
import { backupStamp, createSnapshot, stampToDate } from "@/services/backup";
import { applyImport, backupNow, exportEverything, loadBackupFile, loadLocalBackup, type PendingImport } from "@/services/backupFiles";
import { setSetting, type SettingsMap } from "@/services/settings";
import { Section } from "./Section";

const KIND_LABEL: Record<BackupInfo["kind"], string> = { auto: "Automatic", manual: "Manual", "pre-restore": "Before restore" };
const when = (stamp: string) => stampToDate(stamp).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function ImportDialog({ pending, onClose }: { pending: PendingImport | null; onClose: () => void }) {
  const client = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setProgress(null);
    setResult(null);
    setError(null);
    onClose();
  };
  if (!pending) return null;
  const s = pending.summary;
  const replace = pending.mode === "replace";

  const run = async () => {
    setError(null);
    setProgress("Starting…");
    try {
      const r = await applyImport(pending, (done, total) => setProgress(`Restoring… ${Math.round((done / Math.max(total, 1)) * 100)}%`));
      await client.invalidateQueries();
      setResult(
        `${replace ? "Restored" : "Imported"} ${r.restored.toLocaleString()} items` +
          (r.removed ? `, removed ${r.removed.toLocaleString()} created after the backup` : "") +
          (r.failed ? `. ${r.failed} items couldn't be written (they referred to data missing from the file)` : "") +
          ". Your other devices will receive the changes on their next sync.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal
      open
      onClose={progress ? () => undefined : close}
      title={replace ? "Restore this backup?" : `Import ${s.title ?? "data"}?`}
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" disabled={!!progress} onClick={close}>
              Cancel
            </Button>
            <Button variant={replace ? "danger" : "primary"} loading={!!progress} onClick={() => void run()}>
              {replace ? "Restore" : "Import"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {result ? (
          <p>{result}</p>
        ) : (
          <>
            <p className="text-muted">
              From {new Date(s.createdAt).toLocaleString()}: {s.counts.courses} courses, {s.counts.notes} notes, {s.counts.flashcards} flashcards, {s.counts.tasks} tasks, {s.counts.projects} projects ({s.counts.total.toLocaleString()} items in total).
            </p>
            {replace ? (
              <p>
                StudyOS will be put back to exactly this state on all your devices; anything created or changed since then is removed. A backup of your current data is saved first, so you can undo this from the list below.
              </p>
            ) : (
              <p>The items are added to your data (existing items with the same identity are updated). Nothing else is removed.</p>
            )}
            {(pending.filesRestored > 0 || pending.filesSkipped > 0) && (
              <p className="text-xs text-muted">
                {pending.filesRestored} attached files were copied in{pending.filesSkipped ? `; ${pending.filesSkipped} were already present or not allowed and were skipped` : ""}.
              </p>
            )}
            {progress && <p className="text-accent">{progress}</p>}
            {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

export function BackupSection({ settings }: { settings: SettingsMap }) {
  const client = useQueryClient();
  const desktop = isTauri();
  const backups = useQuery({ queryKey: ["backups"], queryFn: backupList, enabled: desktop });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [deleting, setDeleting] = useState<BackupInfo | null>(null);

  const act = async (key: string, fn: () => Promise<string | null | void>) => {
    setBusy(key);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text, error: false });
      await client.invalidateQueries({ queryKey: ["backups"] });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  };

  const exportJson = async () => {
    const ok = await saveTextFile(`StudyOS backup ${backupStamp()}`, "json", JSON.stringify(await createSnapshot()));
    return ok ? "Backup saved." : null;
  };

  if (!desktop) {
    return (
      <Section title="Backups & export" description="Download all your StudyOS data as a JSON file.">
        <Button icon={<HardDriveDownload className="size-4" />} loading={busy === "json"} onClick={() => void act("json", exportJson)}>
          Export all data (JSON)
        </Button>
        {message && <p className={`mt-2 text-sm ${message.error ? "text-danger" : "text-success"}`}>{message.text}</p>}
      </Section>
    );
  }

  const list = backups.data ?? [];

  return (
    <Section
      title="Backups & export"
      description={
        <>
          <p>StudyOS keeps the last 14 backups on this computer. They contain your data; attached files stay in StudyOS storage and aren't deleted by a restore.</p>
          <p className="mt-2">“Export everything” makes one ZIP with all data and files, for moving to a new computer or keeping a copy elsewhere.</p>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label="Automatic backup"
            className="w-44"
            value={settings.autoBackup}
            onChange={(e) =>
              void act("auto", async () => {
                await setSetting("autoBackup", e.target.value as "on" | "off");
                await client.invalidateQueries({ queryKey: qk.settings });
              })
            }
            options={[
              { value: "on", label: "Daily" },
              { value: "off", label: "Off" },
            ]}
          />
          <Button icon={<Archive className="size-4" />} loading={busy === "now"} onClick={() => void act("now", async () => (await backupNow("manual"), "Backup created."))}>
            Backup now
          </Button>
          <Button icon={<FolderOpen className="size-4" />} onClick={() => void act("folder", backupOpenFolder)}>
            Open folder
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<HardDriveDownload className="size-4" />}
            loading={busy === "zip"}
            onClick={() => void act("zip", async () => {
              const r = await exportEverything();
              return r ? `Export saved with ${r.files} attached files.` : null;
            })}
          >
            Export everything (.zip)
          </Button>
          <Button icon={<HardDriveDownload className="size-4" />} loading={busy === "json"} onClick={() => void act("json", exportJson)}>
            Export data only (.json)
          </Button>
          <Button
            icon={<Upload className="size-4" />}
            loading={busy === "import"}
            onClick={() => void act("import", async () => {
              const path = await pickBackupFile();
              if (path) setPending(await loadBackupFile(path));
            })}
          >
            Import backup…
          </Button>
        </div>
        {message && <p className={`text-sm ${message.error ? "text-danger" : "text-success"}`}>{message.text}</p>}

        <div className="rounded-lg border border-border">
          {list.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-subtle">{backups.isPending ? "Loading…" : "No backups yet."}</p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {list.map((b) => (
                <li key={b.name} className="group flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">{when(b.stamp)}</span>
                  <Badge tone={b.kind === "manual" ? "accent" : "neutral"}>{KIND_LABEL[b.kind]}</Badge>
                  <span className="w-16 text-right text-xs text-muted tabular-nums">{formatBytes(b.sizeBytes)}</span>
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={busy === b.name} onClick={() => void act(b.name, async () => setPending(await loadLocalBackup(b.name)))}>
                    Restore
                  </Button>
                  <IconButton label="Delete backup" onClick={() => setDeleting(b)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ImportDialog
        pending={pending}
        onClose={() => {
          setPending(null);
          void client.invalidateQueries({ queryKey: ["backups"] });
        }}
      />
      <ConfirmDialog
        open={deleting != null}
        title="Delete backup?"
        message={<p>The backup from {deleting ? when(deleting.stamp) : ""} will be deleted from this computer.</p>}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const d = deleting;
          setDeleting(null);
          if (d) void act("delete", () => backupDelete(d.name));
        }}
      />
    </Section>
  );
}
