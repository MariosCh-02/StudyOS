//! Local attachment storage.
//!
//! Imported files are validated (extension allow-list, size limit, and a
//! content signature check so a renamed executable cannot slip through) and
//! copied into `%LOCALAPPDATA%\com.studyos.app\attachments` under a random
//! name. The frontend only ever refers to files by that stored name, which is
//! validated on every call to prevent path traversal. Files are never executed:
//! "open" hands them to the user's default viewer for that document type.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Largest file StudyOS will import.
pub const MAX_BYTES: u64 = 250 * 1024 * 1024;
const SNIFF_LEN: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Signature {
    Pdf,
    Png,
    Jpeg,
    Gif,
    Webp,
    /// ZIP container: .zip and Office Open XML (.docx, .pptx, .xlsx).
    Zip,
    /// Plain text: no NUL bytes.
    Text,
}

/// Allowed extensions with their expected signature and MIME type.
fn allowed(ext: &str) -> Option<(Signature, &'static str)> {
    Some(match ext {
        "pdf" => (Signature::Pdf, "application/pdf"),
        "png" => (Signature::Png, "image/png"),
        "jpg" | "jpeg" => (Signature::Jpeg, "image/jpeg"),
        "gif" => (Signature::Gif, "image/gif"),
        "webp" => (Signature::Webp, "image/webp"),
        "zip" => (Signature::Zip, "application/zip"),
        "docx" => (Signature::Zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "pptx" => (Signature::Zip, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "xlsx" => (Signature::Zip, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "csv" => (Signature::Text, "text/csv"),
        "txt" => (Signature::Text, "text/plain"),
        "md" => (Signature::Text, "text/markdown"),
        _ => return None,
    })
}

fn matches_signature(sig: Signature, head: &[u8]) -> bool {
    match sig {
        Signature::Pdf => head.starts_with(b"%PDF-"),
        Signature::Png => head.starts_with(b"\x89PNG\r\n\x1a\n"),
        Signature::Jpeg => head.starts_with(&[0xFF, 0xD8, 0xFF]),
        Signature::Gif => head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a"),
        Signature::Webp => head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP",
        Signature::Zip => head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06"),
        Signature::Text => !head.contains(&0),
    }
}

fn extension_of(file_name: &str) -> Result<String, String> {
    Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| "The file has no extension, so its type can't be checked.".to_string())
}

/// Checks a file against the import rules. Returns the extension and MIME type.
pub(crate) fn validate(file_name: &str, size: u64, head: &[u8]) -> Result<(String, &'static str), String> {
    let ext = extension_of(file_name)?;
    let (sig, mime) = allowed(&ext).ok_or_else(|| {
        format!(".{ext} files aren't supported. Allowed: PDF, Word, PowerPoint, Excel, CSV, TXT, Markdown, images and ZIP.")
    })?;
    if size > MAX_BYTES {
        return Err(format!("The file is larger than {} MB.", MAX_BYTES / 1024 / 1024));
    }
    if !matches_signature(sig, head) {
        return Err(format!("The contents don't look like a real .{ext} file, so it wasn't imported."));
    }
    Ok((ext, mime))
}

/// Stored names are `<uuid>.<ext>`; anything else is rejected.
pub(crate) fn is_valid_stored_name(name: &str) -> bool {
    let Some((stem, ext)) = name.split_once('.') else { return false };
    stem.len() == 36
        && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        && (1..=5).contains(&ext.len())
        && ext.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

pub(crate) fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the attachments folder: {e}"))?;
    Ok(dir)
}

fn stored_path(app: &AppHandle, stored_name: &str) -> Result<PathBuf, String> {
    // Defence in depth: never hand a non-document type (e.g. .exe) to the system to open.
    let allowed_type = stored_name.rsplit_once('.').is_some_and(|(_, ext)| allowed(ext).is_some());
    if !is_valid_stored_name(stored_name) || !allowed_type {
        return Err("Invalid attachment reference.".into());
    }
    Ok(attachments_dir(app)?.join(stored_name))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    stored_name: String,
    file_name: String,
    mime_type: String,
    size_bytes: u64,
}

/// Copies a file chosen by the user (dialog or drag-and-drop) into StudyOS storage.
#[tauri::command]
pub async fn import_attachment(app: AppHandle, source_path: String) -> Result<StoredFile, String> {
    let source = crate::paths::take_user_path(&app, &source_path)?;
    let meta = fs::metadata(&source).map_err(|e| format!("Couldn't read the file: {e}"))?;
    if !meta.is_file() {
        return Err("Folders can't be attached. Choose a file instead.".into());
    }
    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("The file name isn't valid.")?
        .to_string();

    let mut head = Vec::with_capacity(SNIFF_LEN);
    fs::File::open(&source)
        .and_then(|f| f.take(SNIFF_LEN as u64).read_to_end(&mut head))
        .map_err(|e| format!("Couldn't read the file: {e}"))?;
    let (ext, mime) = validate(&file_name, meta.len(), &head)?;

    let stored_name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    fs::copy(&source, attachments_dir(&app)?.join(&stored_name)).map_err(|e| format!("Couldn't copy the file: {e}"))?;
    Ok(StoredFile { stored_name, file_name, mime_type: mime.into(), size_bytes: meta.len() })
}

/// Stores raw bytes (e.g. an image pasted into a note). The original name is
/// passed URI-encoded in the `x-file-name` header; the body is the file.
#[tauri::command]
pub async fn import_attachment_bytes(app: AppHandle, request: Request<'_>) -> Result<StoredFile, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw file bytes.".into());
    };
    let encoded = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing file name.")?;
    let file_name = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| "The file name isn't valid.")?
        .to_string();

    let (ext, mime) = validate(&file_name, bytes.len() as u64, &bytes[..bytes.len().min(SNIFF_LEN)])?;
    let stored_name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    fs::write(attachments_dir(&app)?.join(&stored_name), bytes).map_err(|e| format!("Couldn't save the file: {e}"))?;
    Ok(StoredFile { stored_name, file_name, mime_type: mime.into(), size_bytes: bytes.len() as u64 })
}

/// Returns a stored file's bytes (for the PDF viewer and inline images).
#[tauri::command]
pub async fn read_attachment(app: AppHandle, stored_name: String) -> Result<Response, String> {
    let path = stored_path(&app, &stored_name)?;
    let bytes = fs::read(&path).map_err(|_| "This file isn't on this computer.".to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn attachment_exists(app: AppHandle, stored_name: String) -> Result<bool, String> {
    Ok(stored_path(&app, &stored_name)?.is_file())
}

/// Opens a stored file in the default viewer for its (allow-listed) type.
#[tauri::command]
pub async fn open_attachment(app: AppHandle, stored_name: String) -> Result<(), String> {
    let path = stored_path(&app, &stored_name)?;
    if !path.is_file() {
        return Err("This file isn't on this computer.".into());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open the file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_matching_content() {
        assert!(validate("slides.PDF", 10, b"%PDF-1.7 ...").is_ok());
        assert!(validate("notes.docx", 10, b"PK\x03\x04rest").is_ok());
        assert!(validate("data.csv", 10, b"a,b\n1,2").is_ok());
        assert_eq!(validate("photo.jpeg", 10, &[0xFF, 0xD8, 0xFF, 0xE0]).unwrap().1, "image/jpeg");
    }

    #[test]
    fn rejects_disallowed_or_disguised_files() {
        assert!(validate("setup.exe", 10, b"MZ").is_err());
        assert!(validate("noext", 10, b"%PDF-").is_err());
        // An executable renamed to .pdf is caught by the signature check.
        assert!(validate("lecture.pdf", 10, b"MZ\x90\x00").is_err());
        assert!(validate("notes.txt", 10, b"bin\x00ary").is_err());
        assert!(validate("huge.pdf", MAX_BYTES + 1, b"%PDF-").is_err());
    }

    #[test]
    fn stored_names_cannot_escape_the_folder() {
        assert!(is_valid_stored_name("0b9c6f1e-3c1d-4f7e-9a59-2f0c3e1d2a4b.pdf"));
        assert!(!is_valid_stored_name("../../Windows/system32/cmd.exe"));
        assert!(!is_valid_stored_name("0b9c6f1e-3c1d-4f7e-9a59-2f0c3e1d2a4b.pdf/../x"));
        assert!(!is_valid_stored_name("..\\secret.pdf"));
        assert!(!is_valid_stored_name("short.pdf"));
    }
}
