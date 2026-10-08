import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Check, CloudUpload, History, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Note } from "@/domain/types";
import { registerFlush } from "@/lib/flush";
import { clearDraft, discardDraft, getRecoverableDraft, saveDraft, saveNote, type NoteDraft } from "@/services/notes";
import { createAutosaver, type Autosaver, type SaveStatus } from "./autosave";
import { NoteEditor } from "./editor/NoteEditor";
import { FlashcardForm } from "@/features/flashcards/FlashcardForm";
import { SaveConceptDialog } from "@/features/knowledge/ConceptForms";
import { TagPicker } from "@/components/TagPicker";
import { useEntriesFor } from "@/hooks/queries";
import { Link } from "react-router";
import type { FlashcardInput } from "@/services/practice";
import type { Editor } from "@tiptap/react";
import { NoteAiMenu } from "@/features/ai/NoteAiMenu";
import { useAiEnabled } from "@/features/ai/AiParts";

export function SaveIndicator({ status, error }: { status: SaveStatus; error?: string | null }) {
  const content = {
    saved: [Check, "Saved"],
    unsaved: [CloudUpload, "Unsaved"],
    saving: [Loader2, "Saving…"],
    error: [AlertTriangle, "Not saved"],
  } as const;
  const [Icon, label] = content[status];
  return (
    <span
      role="status"
      title={error ?? undefined}
      className={clsx("flex items-center gap-1 text-xs", status === "error" ? "text-danger" : status === "saved" ? "text-success" : "text-subtle")}
    >
      <Icon className={clsx("size-3.5", status === "saving" && "animate-spin")} aria-hidden />
      {label}
    </span>
  );
}

interface Props {
  note: Note;
  /** Rendered at the right of the title row (e.g. split-view controls). */
  actions?: React.ReactNode;
  onStatus?: (s: SaveStatus) => void;
  onFilesAttached?: () => void;
}

/**
 * Title + rich-text editor for one note, with autosave and crash recovery.
 * Content is saved ~1.5s after typing stops, and a draft is recorded almost
 * immediately so a crash loses at most a fraction of a second of work.
 */
export function NoteWorkspace({ note, actions, onStatus, onFilesAttached }: Props) {
  const client = useQueryClient();
  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [cardDefaults, setCardDefaults] = useState<Partial<FlashcardInput> | null>(null);
  const [conceptText, setConceptText] = useState<string | null>(null);
  const [savedConcept, setSavedConcept] = useState<string | null>(null);
  const concepts = useEntriesFor("note", note.id);
  const aiEnabled = useAiEnabled();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [initialContent, setInitialContent] = useState(note.content);
  const contentRef = useRef(note.content);
  const saver = useRef<Autosaver | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  // One autosaver per note.
  useEffect(() => {
    const s = createAutosaver(
      { title: note.title, content: note.content },
      {
        save: async (st) => {
          await saveNote(note.id, st.title, st.content);
          await clearDraft(note.id, st.content);
          void client.invalidateQueries({ queryKey: ["notes"] });
        },
        saveDraft: (st) => saveDraft(note.id, st.title, st.content),
        onStatus: (st, err) => {
          setStatus(st);
          setError(err ?? null);
          onStatusRef.current?.(st);
        },
      },
    );
    saver.current = s;
    const unregister = registerFlush(() => s.flush());
    return () => {
      unregister();
      void s.flush().finally(() => s.dispose());
    };
    // Re-create only for a different note; later prop changes come from our own saves.
  }, [note.id]);

  // Offer to restore work that was never saved (e.g. after a crash).
  useEffect(() => {
    let alive = true;
    void getRecoverableDraft(note).then((d) => alive && setDraft(d));
    return () => {
      alive = false;
    };
  }, [note.id]);

  const update = (next: { title?: string; content?: string }) => {
    if (next.content != null) contentRef.current = next.content;
    saver.current?.update({ title: next.title ?? title, content: contentRef.current });
  };

  const restore = () => {
    if (!draft) return;
    setTitle(draft.title);
    contentRef.current = draft.content;
    setInitialContent(draft.content);
    setEditorKey((k) => k + 1); // remount the editor with the recovered document
    saver.current?.update({ title: draft.title, content: draft.content });
    setDraft(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {draft && (
        <div role="alert" className="flex items-center gap-3 border-b border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning">
          <History className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            Unsaved changes from {new Date(draft.savedAt).toLocaleString()} were recovered (StudyOS may have closed unexpectedly).
          </span>
          <Button size="sm" variant="primary" onClick={restore}>
            Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void discardDraft(note.id);
              setDraft(null);
            }}
          >
            Discard
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <input
          aria-label="Note title"
          value={title}
          placeholder="Untitled note"
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            update({ title: e.target.value });
          }}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight placeholder:text-subtle focus:outline-none"
        />
        {aiEnabled && <NoteAiMenu editor={editor} note={note} />}
        <SaveIndicator status={status} error={error} />
        {actions}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-1">
        <TagPicker type="note" id={note.id} compact />
        {(concepts.data ?? []).map((c) => (
          <Link key={c.id} to={`/knowledge/${c.id}`} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted hover:text-accent">
            <Lightbulb className="size-3" aria-hidden /> {c.title}
          </Link>
        ))}
        {savedConcept && <span className="text-[11px] text-success">Saved “{savedConcept}” to the knowledge base</span>}
      </div>
      {(status === "error" || notice) && (
        <p role="alert" className="flex items-center justify-between bg-danger-soft px-4 py-1.5 text-xs text-danger">
          <span>{status === "error" ? `Couldn't save: ${error}. Your text is kept as a recovery draft; StudyOS will retry on your next edit.` : notice}</span>
          {notice && (
            <button type="button" className="underline" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          )}
        </p>
      )}
      <NoteEditor
        key={`${note.id}:${editorKey}`}
        noteId={note.id}
        initialContent={initialContent}
        onChange={(json) => update({ content: json })}
        onBlur={() => void saver.current?.flush()}
        onError={setNotice}
        onFilesAttached={() => {
          void client.invalidateQueries({ queryKey: ["contextPdfs"] });
          void client.invalidateQueries({ queryKey: ["attachments"] });
          onFilesAttached?.();
        }}
        onReady={setEditor}
        onMakeConcept={(text) => setConceptText(text)}
        onMakeFlashcard={(text) => setCardDefaults({ front: text, noteId: note.id, courseId: note.courseId, lessonId: null, subjectId: null, tags: [], topicName: null })}
        className="flex-1"
      />
      <FlashcardForm open={cardDefaults != null} defaults={cardDefaults ?? undefined} onClose={() => setCardDefaults(null)} />
      <SaveConceptDialog
        open={conceptText != null}
        initialName={conceptText ?? ""}
        ctx={{ noteId: note.id, lectureId: note.lectureId, courseId: note.courseId }}
        onClose={() => setConceptText(null)}
        onSaved={(e) => {
          setSavedConcept(e.title);
          void client.invalidateQueries({ queryKey: ["entriesFor"] });
        }}
      />
    </div>
  );
}
