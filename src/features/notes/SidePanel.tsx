import { useEffect, useState } from "react";
import clsx from "clsx";
import { FileText, FolderOpen, Layers, Sigma } from "lucide-react";
import { EmptyState, Spinner } from "@/components/ui/Feedback";
import { useContextPdfs } from "@/hooks/queries";
import type { Attachment } from "@/domain/types";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { PdfViewer } from "@/features/attachments/PdfViewer";
import { FormulaLibrary } from "@/features/practice/FormulaLibrary";
import { ReviewSession } from "@/features/flashcards/ReviewSession";
import { reviewQueue } from "@/features/flashcards/FlashcardsPage";
import { useFlashcards } from "@/hooks/queries";
import { toDateKey } from "@/domain/dates";

/** Quick flashcard review beside your notes (the course's cards, or all). */
function PanelCards({ courseId }: { courseId: string | null }) {
  const cards = useFlashcards({ courseId: courseId ?? undefined, dueBy: toDateKey(new Date()) });
  const [session, setSession] = useState(0);
  if (cards.isPending) return <Spinner />;
  const queue = reviewQueue(cards.data ?? []);
  if (!queue.length) return <EmptyState compact icon={<Layers className="size-4" />} title="No cards due" description={courseId ? "Nothing due for this course." : "Nothing due."} />;
  return <ReviewSession key={session} cards={queue} onDone={() => setSession((n) => n + 1)} />;
}

export type PanelTab = "pdf" | "files" | "formulas" | "cards";

interface Props {
  noteId: string;
  lectureId?: string | null;
  courseId?: string | null;
  paperId?: string | null;
  projectId?: string | null;
  initialTab?: PanelTab;
}

const remembered = (key: string) => {
  try {
    return localStorage.getItem(`studyos.panelPdf.${key}`);
  } catch {
    return null;
  }
};

/**
 * Companion panel for the split view: a PDF (slides, papers, handouts) or the
 * files attached to the note, its lecture and its course.
 */
export function SidePanel({ noteId, lectureId, courseId, paperId, projectId, initialTab = "pdf" }: Props) {
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const pdfs = useContextPdfs({ noteId, lectureId, courseId, paperId, projectId });
  const contextKey = lectureId ?? paperId ?? noteId;
  const [pdfId, setPdfId] = useState<string | null>(() => remembered(contextKey));

  const list = pdfs.data ?? [];
  const current = list.find((p) => p.id === pdfId) ?? list[0] ?? null;

  useEffect(() => {
    if (!current) return;
    try {
      localStorage.setItem(`studyos.panelPdf.${contextKey}`, current.id);
    } catch {
      // Remembering the last PDF is a convenience only.
    }
  }, [current, contextKey]);

  const view = (a: Attachment) => {
    setPdfId(a.id);
    setTab("pdf");
  };

  const ownerLabel = (a: Attachment) => (a.ownerType === "note" ? "Note" : a.ownerType === "lecture" ? (a.isSlides ? "Slides" : "Lecture") : "Course");

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        {(
          [
            ["pdf", "PDF", FileText],
            ["files", "Files", FolderOpen],
            ["formulas", "Formulas", Sigma],
            ["cards", "Flashcards", Layers],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={clsx(
              "flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium",
              tab === value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="size-3.5" aria-hidden /> {label}
          </button>
        ))}
        {tab === "pdf" && list.length > 1 && (
          <select
            aria-label="Choose PDF"
            value={current?.id ?? ""}
            onChange={(e) => setPdfId(e.target.value)}
            className="ml-auto h-7 max-w-[60%] truncate rounded border border-border bg-surface px-1 text-xs text-muted focus:outline-none"
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {ownerLabel(p)} · {p.fileName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "pdf" ? (
          pdfs.isPending ? (
            <Spinner />
          ) : current ? (
            <PdfViewer key={current.id} storedName={current.storedName} fileName={current.fileName} />
          ) : (
            <div className="p-4">
              <EmptyState
                compact
                icon={<FileText className="size-4" />}
                title="No PDF yet"
                description={lectureId ? "Add the lecture slides below; PDFs are marked as slides automatically." : paperId ? "Add the paper's PDF below to read it side by side." : "Add a PDF to this note to read it side by side."}
              />
              <AttachmentList owner={lectureId ? { type: "lecture", id: lectureId } : paperId ? { type: "paper", id: paperId } : { type: "note", id: noteId }} slides={!!lectureId} compact />
            </div>
          )
        ) : tab === "formulas" ? (
          <div className="h-full overflow-y-auto p-3">
            <FormulaLibrary courseId={courseId ?? undefined} compact />
          </div>
        ) : tab === "cards" ? (
          <div className="h-full overflow-y-auto p-3">
            <PanelCards courseId={courseId ?? null} />
          </div>
        ) : (
          <div className="h-full space-y-5 overflow-y-auto p-3">
            <section>
              <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">This note</h3>
              <AttachmentList owner={{ type: "note", id: noteId }} onView={view} compact />
            </section>
            {lectureId && (
              <section>
                <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Lecture</h3>
                <AttachmentList owner={{ type: "lecture", id: lectureId }} slides onView={view} compact />
              </section>
            )}
            {paperId && (
              <section>
                <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Paper</h3>
                <AttachmentList owner={{ type: "paper", id: paperId }} onView={view} compact />
              </section>
            )}
            {projectId && (
              <section>
                <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Project files</h3>
                <AttachmentList owner={{ type: "project", id: projectId }} onView={view} compact />
              </section>
            )}
            {courseId && (
              <section>
                <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Course resources</h3>
                <AttachmentList owner={{ type: "course", id: courseId }} onView={view} compact />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
