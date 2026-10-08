import type { DbDriver } from "./driver";

let driver: DbDriver | null = null;
let opening: Promise<DbDriver> | null = null;
const writeListeners = new Set<() => void>();

const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

/** Wraps a driver so successful writes notify listeners (used to schedule cloud sync). */
function notifying(d: DbDriver): DbDriver {
  return {
    select: (sql, params) => d.select(sql, params),
    async execute(sql, params) {
      const res = await d.execute(sql, params);
      if (WRITE_SQL.test(sql)) writeListeners.forEach((l) => l());
      return res;
    },
  };
}

function openRaw(): Promise<DbDriver> {
  if (driver) return Promise.resolve(driver);
  opening ??= import("./tauriDriver")
    .then((m) => m.createTauriDriver())
    .then((d) => (driver = d))
    .catch((err) => {
      opening = null;
      throw err;
    });
  return opening;
}

/** Shared database driver for application services. Writes through it trigger a sync. */
export async function getDb(): Promise<DbDriver> {
  return notifying(await openRaw());
}

/** Unwrapped driver for the sync engine, whose own bookkeeping writes must not re-trigger sync. */
export function getRawDb(): Promise<DbDriver> {
  return openRaw();
}

/** Subscribes to local data changes made by the app. Returns an unsubscribe function. */
export function onLocalWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/** Replaces the active driver (used by tests). */
export function setDb(d: DbDriver | null): void {
  driver = d;
  opening = null;
}

export * from "./driver";
