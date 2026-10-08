import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import clsx from "clsx";
import { FormModal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useFileDrop } from "@/hooks/useFileDrop";
import { IMAGE_EXTENSIONS, importFileFromBytes, importFileFromPath, pickFiles } from "@/lib/native";
import { openExternal } from "@/lib/links";
import { keys } from "@/lib/platform";
import { addAttachment } from "@/services/attachments";
import { parseDoc } from "@/domain/noteContent";
import { buildExtensions, type MathRequest } from "./extensions";
import { MathDialog } from "./MathDialog";
import { Toolbar } from "./Toolbar";
import "katex/dist/katex.min.css";
import "./editor.css";

interface NoteEditorProps {
  /** Owning note, used to file pasted/dropped images and documents. */
  noteId: string;
  /** Initial document JSON. The editor is uncontrolled afterwards. */
  initialContent: string;
  onChange: (json: string) => void;
  onBlur?: () => void;
  onReady?: (editor: Editor) => void;
  /** Called after non-image files are dropped and attached to the note. */
  onFilesAttached?: () => void;
  onError?: (message: string) => void;
  editable?: boolean;
  className?: string;
  /** Called with the selected text when the learner makes a flashcard. */
  onMakeFlashcard?: (selectedText: string) => void;
  /** Called with the selected text when the learner saves a concept. */
  onMakeConcept?: (selectedText: string) => void;
}

const isImagePath = (p: string) => IMAGE_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? "");

function LinkDialog({ open, initial, onClose, onSubmit }: { open: boolean; initial: string; onClose: () => void; onSubmit: (url: string | null) => void }) {
  const [url, setUrl] = useState(initial);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) {
      setUrl(initial);
      setError(undefined);
    }
  }, [open, initial]);
  const submit = () => {
    const v = url.trim();
    if (!v) return onSubmit(null);
    const normalised = /^[a-z]+:/i.test(v) ? v : `https://${v}`;
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(normalised)) return setError("Use a web address (https://…) or mailto: link.");
    onSubmit(normalised);
  };
  return (
    <FormModal open={open} onClose={onClose} title="Link" submitLabel={initial ? "Update" : "Add link"} onSubmit={submit}>
      <TextField label="Address" autoFocus placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} error={error} hint={keys("Leave empty to remove the link. Ctrl+click a link to open it.")} />
    </FormModal>
  );
}

export function NoteEditor({ noteId, initialContent, onChange, onBlur, onReady, onFilesAttached, onError, editable = true, className, onMakeFlashcard, onMakeConcept }: NoteEditorProps) {
  const [math, setMath] = useState<MathRequest | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const callbacks = useRef({ onChange, onBlur, onError, onFilesAttached });
  callbacks.current = { onChange, onBlur, onError, onFilesAttached };

  const extensions = useMemo(
    () =>
      buildExtensions(
        { onMath: (req) => setMath(req), onLink: () => setLinkOpen(true) },
        "Start writing… Markdown shortcuts work: # heading, - list, [] checklist, ``` code, $$x$$ maths",
      ),
    [],
  );

  const editorRef = useRef<Editor | null>(null);

  const insertImageBytes = useCallback(
    async (file: File) => {
      try {
        const stored = await importFileFromBytes(file.name || "pasted-image.png", await file.arrayBuffer());
        await addAttachment({ type: "note", id: noteId }, stored);
        callbacks.current.onFilesAttached?.();
        editorRef.current?.chain().focus().insertContent({ type: "image", attrs: { storedName: stored.storedName, alt: stored.fileName } }).run();
      } catch (err) {
        callbacks.current.onError?.(err instanceof Error ? err.message : String(err));
      }
    },
    [noteId],
  );

  const editor = useEditor({
    extensions,
    content: parseDoc(initialContent),
    editable,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "studyos-prose", spellcheck: "true" },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest("a[href]");
        // Read-only links are opened by the global link guard; here only Ctrl+click while editing.
        if (a && (event.ctrlKey || event.metaKey)) {
          void openExternal(a.getAttribute("href") ?? "");
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!images.length) return false;
        images.forEach((f) => void insertImageBytes(f));
        return true;
      },
    },
    onUpdate: ({ editor: e }) => callbacks.current.onChange(JSON.stringify(e.getJSON())),
    onBlur: () => callbacks.current.onBlur?.(),
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor) onReady?.(editor);
    // onReady is intentionally only called when the editor instance changes.
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  const insertStoredImage = (storedName: string, alt: string) =>
    editor?.chain().focus().insertContent({ type: "image", attrs: { storedName, alt } }).run();

  const addImageFromPicker = async () => {
    const [path] = await pickFiles({ images: true, multiple: false });
    if (!path) return;
    try {
      const stored = await importFileFromPath(path);
      await addAttachment({ type: "note", id: noteId }, stored);
      onFilesAttached?.();
      insertStoredImage(stored.storedName, stored.fileName);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    }
  };

  const onDrop = useCallback(
    async (paths: string[]) => {
      let attached = false;
      for (const p of paths) {
        try {
          const stored = await importFileFromPath(p);
          await addAttachment({ type: "note", id: noteId }, stored);
          attached = true;
          if (isImagePath(p)) editorRef.current?.chain().focus().insertContent({ type: "image", attrs: { storedName: stored.storedName, alt: stored.fileName } }).run();
        } catch (err) {
          callbacks.current.onError?.(`${p.split(/[\\/]/).pop()}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (attached) callbacks.current.onFilesAttached?.();
    },
    [noteId],
  );
  const { dropProps, isDragOver } = useFileDrop(onDrop, editable);

  const submitMath = (latex: string) => {
    if (!editor || !math) return;
    const chain = editor.chain().focus();
    if (math.pos != null) {
      if (math.display) chain.updateBlockMath({ latex, pos: math.pos }).run();
      else chain.updateInlineMath({ latex, pos: math.pos }).run();
    } else if (math.display) chain.insertBlockMath({ latex }).run();
    else chain.insertInlineMath({ latex }).run();
    setMath(null);
  };

  const deleteMath = () => {
    if (!editor || math?.pos == null) return;
    if (math.display) editor.chain().focus().deleteBlockMath({ pos: math.pos }).run();
    else editor.chain().focus().deleteInlineMath({ pos: math.pos }).run();
    setMath(null);
  };

  const submitLink = (url: string | null) => {
    if (!editor) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url) chain.setLink({ href: url }).run();
    else chain.unsetLink().run();
    setLinkOpen(false);
  };

  if (!editor) return null;

  return (
    <div {...dropProps} className={clsx("flex min-h-0 flex-col", isDragOver && "ring-2 ring-accent ring-inset", className)}>
      {editable && (
        <Toolbar
          editor={editor}
          onLink={() => setLinkOpen(true)}
          onImage={() => void addImageFromPicker()}
          onMath={(display) => setMath({ display, latex: "" })}
          onFlashcard={
            onMakeFlashcard &&
            (() => {
              const { from, to } = editor.state.selection;
              onMakeFlashcard(editor.state.doc.textBetween(from, to, "\n").trim());
            })
          }
          onConcept={
            onMakeConcept &&
            (() => {
              const { from, to } = editor.state.selection;
              onMakeConcept(editor.state.doc.textBetween(from, to, " ").trim());
            })
          }
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && editor.commands.focus("end")}>
        <EditorContent editor={editor} className="mx-auto max-w-3xl px-8 py-6" />
      </div>
      <MathDialog
        open={math != null}
        display={math?.display ?? false}
        initial={math?.latex ?? ""}
        onClose={() => setMath(null)}
        onSubmit={submitMath}
        onDelete={math?.pos != null ? deleteMath : undefined}
      />
      <LinkDialog
        open={linkOpen}
        initial={(editor.getAttributes("link").href as string | undefined) ?? ""}
        onClose={() => setLinkOpen(false)}
        onSubmit={submitLink}
      />
    </div>
  );
}
