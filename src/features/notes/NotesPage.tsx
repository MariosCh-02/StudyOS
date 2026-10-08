import { useDeferredValue, useMemo, useState } from "react";
import { Search, StickyNote } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { useAllCourses, useNotes } from "@/hooks/queries";
import { NewNoteMenu } from "./NewNoteMenu";
import { NoteList } from "./NoteList";
import { ShowMore, usePaged } from "@/components/ShowMore";

export default function NotesPage() {
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const deferredSearch = useDeferredValue(search);
  const page = usePaged(300, `${deferredSearch}|${courseId}`);
  const notes = useNotes({ search: deferredSearch, courseId: courseId || undefined, limit: page.limit });
  const courses = useAllCourses();
  const courseMap = useMemo(() => new Map((courses.data ?? []).map((c) => [c.id, c])), [courses.data]);

  return (
    <>
      <PageHeader title="Notes" subtitle="Every note across your courses and lectures." actions={<NewNoteMenu courseId={courseId || null} />} />
      <div className="mb-4 flex gap-3">
        <label className="relative flex-1">
          <span className="sr-only">Search notes</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            placeholder="Search titles and content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </label>
        <select
          aria-label="Filter by course"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="h-9 w-64 rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">All courses</option>
          {(courses.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} · ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </div>
      <Card>
        {notes.isPending ? (
          <Spinner />
        ) : notes.error ? (
          <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />
        ) : notes.data.length === 0 ? (
          <EmptyState
            icon={<StickyNote className="size-5" />}
            title={search || courseId ? "No matching notes" : "No notes yet"}
            description={search || courseId ? "Try a different search or course." : "Create a note here, or start a lecture from a course to take notes with the lecture template."}
          />
        ) : (
          <>
            <NoteList notes={notes.data} courses={courseMap} showCourse />
            {notes.data.length >= page.limit && <ShowMore shown={notes.data.length} total={null} onMore={page.more} />}
          </>
        )}
      </Card>
    </>
  );
}
