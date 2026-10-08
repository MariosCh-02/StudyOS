import { isTauri, pickSavePath, writeTextFile } from "./native";

const MIME: Record<string, string> = { json: "application/json", md: "text/markdown", csv: "text/csv", txt: "text/plain", bib: "application/x-bibtex", ics: "text/calendar" };
const LABEL: Record<string, string> = { json: "JSON", md: "Markdown", csv: "CSV (spreadsheet)", txt: "Text", bib: "BibTeX", ics: "Calendar" };

/**
 * Saves text through the native save dialog (or as a download in a browser tab).
 * Returns false if the user cancelled.
 */
export async function saveTextFile(baseName: string, extension: keyof typeof MIME | string, text: string): Promise<boolean> {
  const fileName = `${baseName}.${extension}`;
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([text], { type: MIME[extension] ?? "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  const path = await pickSavePath(fileName, extension, LABEL[extension] ?? extension.toUpperCase());
  if (!path) return false;
  await writeTextFile(path, text);
  return true;
}
