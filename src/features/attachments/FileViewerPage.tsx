import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, FileX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import type { Attachment } from "@/domain/types";
import { getAttachment } from "@/services/attachments";
import { PdfViewer } from "./PdfViewer";

/** Full-window PDF reader for course resources, papers and lecture files. */
export default function FileViewerPage() {
  const { attachmentId = "" } = useParams();
  const navigate = useNavigate();
  const [file, setFile] = useState<Attachment | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    getAttachment(attachmentId).then(setFile, setError);
  }, [attachmentId]);

  if (error) return <ErrorState error={error} />;
  if (file === undefined) return <Spinner />;
  if (!file || file.mimeType !== "application/pdf")
    return (
      <EmptyState
        icon={<FileX className="size-5" />}
        title="File not available"
        description="It may have been removed, or it isn't a PDF."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-2">
        <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg">
          <ArrowLeft className="size-3.5" aria-hidden /> Back
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <PdfViewer storedName={file.storedName} fileName={file.fileName} />
      </div>
    </div>
  );
}
