/**
 * Schedules sync for the signed-in user: on start, shortly after local edits,
 * when the window regains focus or the network returns, and every few minutes.
 */
import { getRawDb, onLocalWrite } from "@/lib/db";
import { countPendingChanges, syncOnce, type RemoteStore } from "./engine";

export type SyncPhase = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: Date | null;
  pendingChanges: number;
  error: string | null;
}

const EDIT_DEBOUNCE_MS = 3_000;
const INTERVAL_MS = 3 * 60_000;

let status: SyncStatus = { phase: "idle", lastSyncedAt: null, pendingChanges: 0, error: null };
const statusListeners = new Set<(s: SyncStatus) => void>();
const remoteChangeListeners = new Set<() => void>();

let remote: RemoteStore | null = null;
let running: Promise<void> | null = null;
let again = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let teardown: (() => void) | null = null;

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l(status));
}

export const getSyncStatus = () => status;

export function subscribeSyncStatus(listener: (s: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Notified after data downloaded from the cloud changed the local database. */
export function onRemoteChanges(listener: () => void): () => void {
  remoteChangeListeners.add(listener);
  return () => remoteChangeListeners.delete(listener);
}

async function runOnce(): Promise<void> {
  if (!remote) return;
  const db = await getRawDb();
  if (!navigator.onLine) {
    setStatus({ phase: "offline", pendingChanges: await countPendingChanges(db) });
    return;
  }
  setStatus({ phase: "syncing", error: null });
  try {
    const result = await syncOnce(db, remote);
    setStatus({ phase: "idle", lastSyncedAt: new Date(), pendingChanges: await countPendingChanges(db) });
    if (result.pulled > 0) remoteChangeListeners.forEach((l) => l());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus({ phase: navigator.onLine ? "error" : "offline", error: message, pendingChanges: await countPendingChanges(db) });
  }
}

/** Runs a sync now; if one is in progress, queues exactly one more run after it. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

function scheduleSoon() {
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), EDIT_DEBOUNCE_MS);
}

export function startSync(store: RemoteStore): void {
  stopSync();
  remote = store;
  const unsubscribeWrites = onLocalWrite(scheduleSoon);
  const onFocusOrOnline = () => void syncNow();
  window.addEventListener("focus", onFocusOrOnline);
  window.addEventListener("online", onFocusOrOnline);
  const offline = () => setStatus({ phase: "offline" });
  window.addEventListener("offline", offline);
  const timer = setInterval(() => void syncNow(), INTERVAL_MS);
  teardown = () => {
    unsubscribeWrites();
    window.removeEventListener("focus", onFocusOrOnline);
    window.removeEventListener("online", onFocusOrOnline);
    window.removeEventListener("offline", offline);
    clearInterval(timer);
    clearTimeout(debounce);
  };
  void syncNow();
}

export function stopSync(): void {
  teardown?.();
  teardown = null;
  remote = null;
  setStatus({ phase: "idle", lastSyncedAt: null, error: null });
}
