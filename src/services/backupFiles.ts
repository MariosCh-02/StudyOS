/**
 * Backup and import actions that touch files (desktop app). The data logic
 * lives in backup.ts; this module adds the Rust file commands around it.
 */
import { archiveExport, backupImportFile, backupList, backupRead, backupSave, pickSavePath, type BackupInfo } from "@/lib/native";
import { applySnapshot, autoBackupDue, backupStamp, createSnapshot, parseSnapshot, summarize, type RestoreResult, type Snapshot, type SnapshotSummary } from "./backup";
import { getSetting } from "./settings";

export async function backupNow(kind: BackupInfo["kind"] = "manual"): Promise<BackupInfo> {
  return backupSave(backupStamp(), kind, JSON.stringify(await createSnapshot()));
}

/** Makes the daily automatic backup if it is due and enabled. Returns it, or null. */
export async function runAutoBackup(now = new Date()): Promise<BackupInfo | null> {
  if ((await getSetting("autoBackup")) !== "on") return null;
  if (!autoBackupDue(await backupList(), now)) return null;
  return backupNow("auto");
}

export interface PendingImport {
  snapshot: Snapshot;
  summary: SnapshotSummary;
  /** A full backup replaces everything; a partial export (e.g. a programme) is merged. */
  mode: "replace" | "merge";
  filesRestored: number;
  filesSkipped: number;
}

const pending = (snapshot: Snapshot, filesRestored = 0, filesSkipped = 0): PendingImport => ({
  snapshot,
  summary: summarize(snapshot),
  mode: snapshot.scope === "all" ? "replace" : "merge",
  filesRestored,
  filesSkipped,
});

/** Reads one of the local backups, ready to confirm and restore. */
export async function loadLocalBackup(name: string): Promise<PendingImport> {
  return pending(parseSnapshot(await backupRead(name)));
}

/** Reads a backup (.json) or export (.zip) chosen by the user. Attachment files in a ZIP are copied in now (never overwriting). */
export async function loadBackupFile(path: string): Promise<PendingImport> {
  const r = await backupImportFile(path);
  return pending(parseSnapshot(r.data), r.filesRestored, r.filesSkipped);
}

/**
 * Applies a confirmed import. A full restore first saves a "pre-restore"
 * backup of the current state, so it can be undone.
 */
export async function applyImport(p: PendingImport, onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  if (p.mode === "replace") await backupNow("pre-restore");
  return applySnapshot(p.snapshot, { replace: p.mode === "replace", onProgress });
}

/** "Export entire StudyOS": a ZIP with all data and attachment files. Returns null if cancelled. */
export async function exportEverything(): Promise<{ files: number } | null> {
  const path = await pickSavePath(`StudyOS export ${backupStamp().slice(0, 8)}.zip`, "zip", "StudyOS export");
  if (!path) return null;
  const files = await archiveExport(path, JSON.stringify(await createSnapshot()));
  return { files };
}
