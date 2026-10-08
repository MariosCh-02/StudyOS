/**
 * Autosave for the note editor.
 *
 * Every edit is written to a crash-recovery draft almost immediately and to the
 * note itself a little later. `flush()` forces both (used on blur, navigation
 * and window close). Saves never overlap; edits made during a save are picked
 * up by the next one, so the latest state always wins.
 */

export interface NoteState {
  title: string;
  content: string;
}

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface AutosaverOptions {
  save: (state: NoteState) => Promise<void>;
  saveDraft: (state: NoteState) => Promise<void>;
  onStatus: (status: SaveStatus, error?: string) => void;
  saveDelayMs?: number;
  draftDelayMs?: number;
}

export interface Autosaver {
  update(state: NoteState): void;
  flush(): Promise<void>;
  dispose(): void;
  readonly status: SaveStatus;
}

export function createAutosaver(initial: NoteState, opts: AutosaverOptions): Autosaver {
  const saveDelay = opts.saveDelayMs ?? 1500;
  const draftDelay = opts.draftDelayMs ?? 300;

  let saved = initial;
  let latest = initial;
  let status: SaveStatus = "saved";
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  const same = (a: NoteState, b: NoteState) => a.title === b.title && a.content === b.content;

  const setStatus = (s: SaveStatus, error?: string) => {
    status = s;
    opts.onStatus(s, error);
  };

  const writeDraft = async () => {
    clearTimeout(draftTimer);
    if (same(latest, saved)) return;
    try {
      await opts.saveDraft(latest);
    } catch {
      // A failed draft write is not fatal; the real save will still run.
    }
  };

  const runSave = async (): Promise<void> => {
    clearTimeout(saveTimer);
    if (inFlight) {
      await inFlight;
      return same(latest, saved) ? undefined : runSave();
    }
    if (same(latest, saved)) {
      if (status !== "saved") setStatus("saved");
      return;
    }
    const snapshot = latest;
    setStatus("saving");
    inFlight = opts
      .save(snapshot)
      .then(() => {
        saved = snapshot;
        if (!disposed) setStatus(same(latest, saved) ? "saved" : "unsaved");
      })
      .catch((err: unknown) => {
        if (!disposed) setStatus("error", err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        inFlight = null;
      });
    await inFlight;
    // Edits that arrived while saving are scheduled again.
    if (!disposed && !same(latest, saved) && status !== "error") schedule();
  };

  const schedule = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void runSave(), saveDelay);
  };

  return {
    get status() {
      return status;
    },
    update(state) {
      if (disposed || same(state, latest)) return;
      latest = state;
      if (status !== "saving") setStatus("unsaved");
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => void writeDraft(), draftDelay);
      schedule();
    },
    async flush() {
      await writeDraft();
      await runSave();
    },
    dispose() {
      disposed = true;
      clearTimeout(saveTimer);
      clearTimeout(draftTimer);
    },
  };
}
