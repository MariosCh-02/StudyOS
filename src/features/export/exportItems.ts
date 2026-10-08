import type { ExportItem } from "@/components/ExportMenu";
import { saveTextFile } from "@/lib/saveFile";
import { printHtml } from "@/lib/print";
import { renderMarkdown } from "@/lib/markdown";
import { exportProgramme } from "@/services/backup";
import { courseNotesMarkdown, fileSafe, flashcardsCsv, gradesCsv, noteMarkdown, projectMarkdown, tasksCsv } from "@/services/exporters";

const saved = (ok: boolean) => (ok ? "Saved." : null);
const PDF_HINT = "Choose “Microsoft Print to PDF” as the printer.";

const markdownItems = (load: () => Promise<{ title: string; markdown: string }>, what: string): ExportItem[] => [
  {
    label: `${what} as Markdown`,
    hint: ".md, opens in any editor, Obsidian or Notion",
    run: async () => {
      const { title, markdown } = await load();
      return saved(await saveTextFile(fileSafe(title), "md", markdown));
    },
  },
  {
    label: `${what} as PDF`,
    hint: PDF_HINT,
    run: async () => {
      const { title, markdown } = await load();
      printHtml(title, renderMarkdown(markdown));
    },
  },
];

export const noteExports = (noteId: string): ExportItem[] => markdownItems(() => noteMarkdown(noteId), "Note");

export const projectExports = (projectId: string): ExportItem[] => markdownItems(() => projectMarkdown(projectId), "Project");

export const courseExports = (courseId: string, courseLabel: string): ExportItem[] => [
  ...markdownItems(() => courseNotesMarkdown(courseId), "All notes"),
  { label: "Grades as CSV", hint: "Opens in Excel", run: async () => saved(await saveTextFile(fileSafe(`${courseLabel} grades`), "csv", await gradesCsv(courseId))) },
  { label: "Flashcards as CSV", hint: "Front, back, tags; imports into Anki", run: async () => saved(await saveTextFile(fileSafe(`${courseLabel} flashcards`), "csv", await flashcardsCsv(courseId))) },
];

export const programmeExports = (programmeId: string, name: string): ExportItem[] => [
  {
    label: "Programme as JSON",
    hint: "Everything in it; can be imported again in Settings → Backups",
    run: async () => saved(await saveTextFile(fileSafe(`${name} export`), "json", JSON.stringify(await exportProgramme(programmeId), null, 1))),
  },
  { label: "All grades as CSV", hint: "Every course, opens in Excel", run: async () => saved(await saveTextFile(fileSafe(`${name} grades`), "csv", await gradesCsv())) },
];

export const tasksExports = (): ExportItem[] => [{ label: "Tasks as CSV", hint: "Opens in Excel", run: async () => saved(await saveTextFile("StudyOS tasks", "csv", await tasksCsv())) }];

export const flashcardExports = (): ExportItem[] => [{ label: "Flashcards as CSV", hint: "Front, back, tags; imports into Anki", run: async () => saved(await saveTextFile("StudyOS flashcards", "csv", await flashcardsCsv())) }];

export const gradesExports = (): ExportItem[] => [{ label: "All grades as CSV", hint: "Every course, opens in Excel", run: async () => saved(await saveTextFile("StudyOS grades", "csv", await gradesCsv())) }];
