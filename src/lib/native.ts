/** Typed wrappers around StudyOS's Rust commands (src-tauri/src/attachments.rs). */
import { invoke } from "@tauri-apps/api/core";

export interface StoredFile {
  storedName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const message = (err: unknown) => (typeof err === "string" ? err : err instanceof Error ? err.message : "The file operation failed.");

async function call<T>(cmd: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]): Promise<T> {
  try {
    return await invoke<T>(cmd, args, options);
  } catch (err) {
    throw new Error(message(err));
  }
}

export const importFileFromPath = (sourcePath: string) => call<StoredFile>("import_attachment", { sourcePath });

export async function importFileFromBytes(fileName: string, bytes: ArrayBuffer | Uint8Array): Promise<StoredFile> {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return call<StoredFile>("import_attachment_bytes", body, { headers: { "x-file-name": encodeURIComponent(fileName) } });
}

export const readStoredFile = (storedName: string) => call<ArrayBuffer>("read_attachment", { storedName });
export const storedFileExists = (storedName: string) => call<boolean>("attachment_exists", { storedName });
export const openStoredFile = (storedName: string) => call<void>("open_attachment", { storedName });

/** File types the importer accepts (mirrors the Rust allow-list). */
export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx", "csv", "txt", "md", "png", "jpg", "jpeg", "gif", "webp", "zip"];
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

/**
 * File dialogs are opened by the Rust side, which remembers the chosen paths:
 * file commands only accept paths picked here or dropped onto the window.
 */
type PickKind = "attachments" | "images" | "ics" | "bib" | "backup";
const pickOpen = (kind: PickKind, multiple: boolean) => call<string[]>("pick_open_files", { kind, multiple });

export async function pickFiles(options: { multiple?: boolean; images?: boolean } = {}): Promise<string[]> {
  return pickOpen(options.images ? "images" : "attachments", options.multiple ?? true);
}

export const readTextFile = (path: string) => call<string>("read_text_file", { path });
export const writeTextFile = (path: string, contents: string) => call<void>("write_text_file", { path, contents });

export async function pickIcsFile(): Promise<string | null> {
  return (await pickOpen("ics", false))[0] ?? null;
}

export async function pickSavePath(defaultName: string, extension: string, label: string): Promise<string | null> {
  return call<string | null>("pick_save_file", { defaultName, extension, label });
}

export async function pickBibFile(): Promise<string | null> {
  return (await pickOpen("bib", false))[0] ?? null;
}

/** True inside the desktop app; false in a plain browser tab. */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ------------------------------------------------------------- optional AI

export interface AiCompletionRequest {
  provider: "openai" | "anthropic" | "ollama";
  model: string;
  baseUrl?: string | null;
  system: string;
  prompt: string;
  maxTokens: number;
}
export interface AiReply {
  text: string;
  truncated: boolean;
}

/** Sends one request to the configured provider. The API key is read from the OS credential store in Rust. */
export const aiComplete = (request: AiCompletionRequest) => call<AiReply>("ai_complete", { request });
export const aiListModels = (provider: string, baseUrl?: string | null) => call<string[]>("ai_list_models", { provider, baseUrl: baseUrl ?? null });
export const aiSetKey = (provider: string, key: string) => call<void>("ai_set_key", { provider, key });
export const aiHasKey = (provider: string) => call<boolean>("ai_has_key", { provider });
export const aiDeleteKey = (provider: string) => call<void>("ai_delete_key", { provider });

// ------------------------------------------------------- backups & exports

export interface BackupInfo {
  name: string;
  kind: "auto" | "manual" | "pre-restore";
  stamp: string;
  sizeBytes: number;
}
export interface ArchiveImport {
  data: string;
  filesRestored: number;
  filesSkipped: number;
}

export const backupSave = (stamp: string, kind: BackupInfo["kind"], contents: string) => call<BackupInfo>("backup_save", { stamp, kind, contents });
export const backupList = () => call<BackupInfo[]>("backup_list");
export const backupRead = (name: string) => call<string>("backup_read", { name });
export const backupDelete = (name: string) => call<void>("backup_delete", { name });
export const backupOpenFolder = () => call<void>("backup_open_folder");
/** Writes a ZIP with the snapshot and every attachment file. Returns the number of files included. */
export const archiveExport = (path: string, data: string) => call<number>("archive_export", { path, data });
/** Reads a .json backup or .zip export; a ZIP's files are restored into attachment storage. */
export const backupImportFile = (path: string) => call<ArchiveImport>("backup_import_file", { path });

export async function pickBackupFile(): Promise<string | null> {
  return (await pickOpen("backup", false))[0] ?? null;
}
