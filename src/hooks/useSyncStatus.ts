import { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from "@/sync/syncService";

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}

export function describeSync(s: SyncStatus): string {
  switch (s.phase) {
    case "syncing":
      return "Syncing…";
    case "offline":
      return s.pendingChanges ? `Offline · ${s.pendingChanges} change${s.pendingChanges === 1 ? "" : "s"} waiting` : "Offline · saved on this PC";
    case "error":
      return "Sync failed";
    default:
      if (s.pendingChanges) return `${s.pendingChanges} change${s.pendingChanges === 1 ? "" : "s"} waiting`;
      return s.lastSyncedAt ? `Synced ${s.lastSyncedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "Not synced yet";
  }
}
