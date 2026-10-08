import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Eye, File, FileImage, FileSpreadsheet, FileText, Paperclip, Presentation, Star, Trash2, Upload } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useAttachments } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useFileDrop } from "@/hooks/useFileDrop";
import type { Attachment } from "@/domain/types";
import { importFileFromPath, openStoredFile, pickFiles, storedFileExists } from "@/lib/native";
import { addAttachment, deleteAttachment, formatBytes, setAttachmentSlides, type AttachmentOwner } from "@/services/attachments";

function iconFor(a: Attachment) {
  if (a.mimeType === "application/pdf") return FileText;
  if (a.mimeType.startsWith("image/")) return FileImage;
  if (a.fileName.endsWith(".pptx")) return Presentation;
  if (a.fileName.endsWith(".xlsx") || a.fileName.endsWith(".csv")) return FileSpreadsheet;
  return File;
}

/** Which attachments exist on this PC (files are not synced between devices). */
function useLocalAvailability(items: Attachment[]) {
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(items.map(async (a) => [a.id, await storedFileExists(a.storedName).catch(() => false)] as const)).then((pairs) => {
      if (!cancelled) setAvailable(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [items]);
  return available;
}

interface Props {
  owner: AttachmentOwner;
  /** Allow marking files as lecture slides. */
  slides?: boolean;
  /** Opens a PDF inside StudyOS (e.g. in the split view). */
  onView?: (a: Attachment) => void;
  compact?: boolean;
}

/** Shows how many file imports are in progress and any failures. */
export function useImport(owner: AttachmentOwner, slidesByDefault = false) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      setErrors([]);
      setBusy((n) => n + paths.length);
      const failures: string[] = [];
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop() ?? path;
        try {
          const stored = await importFileFromPath(path);
          await addAttachment(owner, stored, slidesByDefault && stored.mimeType === "application/pdf");
        } catch (err) {
          failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setBusy((n) => n - 1);
        }
      }
      setErrors(failures);
      await client.invalidateQueries();
    },
    [owner, slidesByDefault, client],
  );

  return { importPaths, busy, errors, clearErrors: () => setErrors([]) };
}

export function AttachmentList({ owner, slides, onView, compact }: Props) {
  const client = useQueryClient();
  const attachments = useAttachments(owner);
  const items = useMemo(() => attachments.data ?? [], [attachments.data]);
  const available = useLocalAvailability(items);
  const { importPaths, busy, errors } = useImport(owner, slides);
  const { dropProps, isDragOver } = useFileDrop(importPaths);
  const [openError, setOpenError] = useState<string | null>(null);
  const remove = useConfirmAction((a: Attachment) => deleteAttachment(a.id));

  const browse = async () => {
    const paths = await pickFiles({ multiple: true });
    if (paths.length) await importPaths(paths);
  };

  const toggleSlides = async (a: Attachment) => {
    await setAttachmentSlides(a.id, !a.isSlides);
    await client.invalidateQueries();
  };

  const open = async (a: Attachment) => {
    setOpenError(null);
    if (onView && a.mimeType === "application/pdf") return onView(a);
    try {
      await openStoredFile(a.storedName);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      {...dropProps}
      className={clsx("rounded-lg border border-dashed transition-colors", isDragOver ? "border-accent bg-accent-soft/40" : "border-transparent")}
    >
      {items.length > 0 && (
        <ul className="divide-y divide-border">
          {items.map((a) => {
            const Icon = iconFor(a);
            const here = available[a.id] !== false;
            return (
              <li key={a.id} className="group flex items-center gap-3 px-2 py-2">
                <Icon className={clsx("size-4 shrink-0", here ? "text-muted" : "text-subtle opacity-50")} aria-hidden />
                <button
                  type="button"
                  onClick={() => void open(a)}
                  disabled={!here}
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                  title={here ? "Open" : "This file was added on another computer"}
                >
                  <span className={clsx("block truncate text-sm", here ? "hover:text-accent" : "text-subtle")}>{a.fileName}</span>
                  <span className="block text-xs text-subtle">
                    {formatBytes(a.sizeBytes)}
                    {a.isSlides && " · Slides"}
                    {!here && " · On another computer"}
                  </span>
                </button>
                <div className="flex shrink-0 opacity-60 group-hover:opacity-100">
                  {onView && a.mimeType === "application/pdf" && here && (
                    <IconButton label={`View ${a.fileName}`} onClick={() => onView(a)}>
                      <Eye className="size-3.5" />
                    </IconButton>
                  )}
                  {slides && a.mimeType === "application/pdf" && (
                    <IconButton
                      label={a.isSlides ? "Unmark as slides" : "Mark as lecture slides"}
                      onClick={() => void toggleSlides(a)}
                      className={a.isSlides ? "text-warning" : undefined}
                    >
                      <Star className={clsx("size-3.5", a.isSlides && "fill-current")} />
                    </IconButton>
                  )}
                  <IconButton label={`Remove ${a.fileName}`} onClick={() => remove.ask(a)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={clsx("flex items-center gap-3", compact ? "px-2 py-2" : "px-2 py-3", items.length > 0 && "border-t border-border")}>
        <Button size="sm" icon={<Upload className="size-3.5" />} loading={busy > 0} onClick={() => void browse()}>
          {busy > 0 ? `Adding ${busy}…` : "Add files"}
        </Button>
        <span className="flex items-center gap-1.5 text-xs text-subtle">
          <Paperclip className="size-3" aria-hidden /> or drop files here
        </span>
      </div>

      {(errors.length > 0 || openError) && (
        <ul role="alert" className="mx-2 mb-2 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
          {openError && <li>{openError}</li>}
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={remove.target != null}
        title="Remove file?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={<p>“{remove.target?.fileName}” will be removed from StudyOS.</p>}
      />
    </div>
  );
}
