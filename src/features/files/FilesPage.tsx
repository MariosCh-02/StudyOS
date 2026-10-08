import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, EmptyState, Spinner } from "@/components/ui/Feedback";
import { formatDate } from "@/domain/dates";
import { formatBytes, listAllAttachments } from "@/services/attachments";
import { useOpenResult } from "@/features/search/SearchPage";

const OWNER_LABEL = { course: "Course", lecture: "Lecture", note: "Note", assignment: "Assignment", exam: "Exam", project: "Project", paper: "Paper" } as const;
const KIND = (m: string, name: string) => (m === "application/pdf" ? "PDF" : m.startsWith("image/") ? "Image" : (name.split(".").pop() ?? "").toUpperCase());

/** All files across courses, lectures, notes, assignments and exams. */
export default function FilesPage() {
  const files = useQuery({ queryKey: ["allAttachments"], queryFn: listAllAttachments });
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const open = useOpenResult();
  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (files.data ?? []).filter((f) => (!t || f.fileName.toLowerCase().includes(t) || (f.ownerTitle ?? "").toLowerCase().includes(t)) && (!kind || KIND(f.mimeType, f.fileName) === kind));
  }, [files.data, search, kind]);
  const kinds = [...new Set((files.data ?? []).map((f) => KIND(f.mimeType, f.fileName)))].sort();

  return (
    <>
      <PageHeader title="Files" subtitle="Slides, papers, handouts and images attached anywhere in StudyOS. Files are stored on the computer that added them." />
      <div className="mb-4 flex gap-3">
        <label className="relative flex-1">
          <span className="sr-only">Filter files</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by file or course/lecture name…" className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
        </label>
        <select aria-label="File type" value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 w-40 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none">
          <option value="">All types</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <Card>
        {files.isPending ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState icon={<FolderOpen className="size-5" />} title={files.data?.length ? "No matching files" : "No files yet"} description="Attach files to courses, lectures, notes, assignments, exams, projects and papers." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Attached to</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 text-right font-medium">Size</th>
                <th className="px-4 py-2 text-right font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="max-w-0 px-4 py-2">
                    <button type="button" onClick={() => void open({ type: "attachment", id: f.id })} className="block w-full truncate text-left hover:text-accent">
                      {f.fileName}
                    </button>
                  </td>
                  <td className="max-w-48 truncate px-2 py-2 text-muted">
                    {OWNER_LABEL[f.ownerType]}: {f.ownerTitle ?? "(removed)"}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted">{KIND(f.mimeType, f.fileName)}{f.isSlides ? " · slides" : ""}</td>
                  <td className="px-2 py-2 text-right text-xs text-muted tabular-nums">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-4 py-2 text-right text-xs text-muted">{formatDate(f.createdAt.slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
