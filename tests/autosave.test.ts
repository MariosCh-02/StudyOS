import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type NoteState, type SaveStatus } from "../src/features/notes/autosave";

const s = (content: string, title = "T"): NoteState => ({ title, content });

function setup(saveImpl?: (st: NoteState) => Promise<void>) {
  const saves: NoteState[] = [];
  const drafts: NoteState[] = [];
  const statuses: SaveStatus[] = [];
  const saver = createAutosaver(s("a"), {
    save: saveImpl ?? (async (st) => void saves.push(st)),
    saveDraft: async (st) => void drafts.push(st),
    onStatus: (st) => statuses.push(st),
    saveDelayMs: 1000,
    draftDelayMs: 100,
  });
  return { saver, saves, drafts, statuses };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosave", () => {
  it("debounces saves and writes a draft first", async () => {
    const { saver, saves, drafts } = setup();
    saver.update(s("ab"));
    saver.update(s("abc"));
    await vi.advanceTimersByTimeAsync(150);
    expect(drafts.map((d) => d.content)).toEqual(["abc"]);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves.map((d) => d.content)).toEqual(["abc"]);
    expect(saver.status).toBe("saved");
  });

  it("ignores no-op updates", async () => {
    const { saver, saves, statuses } = setup();
    saver.update(s("a"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it("flush saves immediately", async () => {
    const { saver, saves } = setup();
    saver.update(s("x"));
    await saver.flush();
    expect(saves.map((d) => d.content)).toEqual(["x"]);
  });

  it("never loses edits made during a slow save", async () => {
    let release!: () => void;
    const saves: string[] = [];
    const { saver } = setup((st) => {
      saves.push(st.content);
      return saves.length === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    });
    saver.update(s("first"));
    await vi.advanceTimersByTimeAsync(1000); // save #1 starts and hangs
    saver.update(s("second"));
    release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves).toEqual(["first", "second"]);
    expect(saver.status).toBe("saved");
  });

  it("reports errors and retries on the next edit", async () => {
    let fail = true;
    const { saver, statuses } = setup(async () => {
      if (fail) throw new Error("disk full");
    });
    saver.update(s("x"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saver.status).toBe("error");
    fail = false;
    saver.update(s("xy"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saver.status).toBe("saved");
    expect(statuses).toContain("error");
  });

  it("detects title-only changes", async () => {
    const { saver, saves } = setup();
    saver.update(s("a", "New title"));
    await saver.flush();
    expect(saves[0]?.title).toBe("New title");
  });
});
