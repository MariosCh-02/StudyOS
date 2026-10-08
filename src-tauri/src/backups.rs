//! Local backups and the full "Export entire StudyOS" archive.
//!
//! Backups are JSON snapshots of the database written by the frontend into
//! `backups` in the app's local data folder (`%LOCALAPPDATA%\com.studyos.app`
//! on Windows, `~/Library/Application Support/com.studyos.app` on macOS); the
//! newest 14 are kept. The full
//! export is a ZIP with the same snapshot plus every attachment file. On
//! import, archive entries are validated like any other imported file (name,
//! extension allow-list, size and content signature) and never executed.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::attachments::{attachments_dir, is_valid_stored_name, validate, MAX_BYTES};

const KEEP: usize = 14;
const PREFIX: &str = "studyos-backup-";
const KINDS: &[&str] = &["auto", "manual", "pre-restore"];
const DATA_ENTRY: &str = "studyos-data.json";
const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;
/// Upper bound on everything a single import may write to disk.
const MAX_IMPORT_BYTES: u64 = 20 * 1024 * 1024 * 1024;
/// Reject entries that inflate suspiciously (zip bombs).
const MAX_RATIO: u64 = 200;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    name: String,
    kind: String,
    /// "YYYYMMDD-HHMMSS" local time, from the file name.
    stamp: String,
    size_bytes: u64,
}

/// `studyos-backup-YYYYMMDD-HHMMSS-<kind>.json` → (stamp, kind).
fn parse_name(name: &str) -> Option<(String, String)> {
    let rest = name.strip_prefix(PREFIX)?.strip_suffix(".json")?;
    let (stamp, kind) = (rest.get(..15)?, rest.get(16..)?);
    let b = stamp.as_bytes();
    let stamp_ok = b.len() == 15 && b[8] == b'-' && b.iter().enumerate().all(|(i, c)| i == 8 || c.is_ascii_digit());
    (stamp_ok && rest.as_bytes().get(15) == Some(&b'-') && KINDS.contains(&kind)).then(|| (stamp.to_string(), kind.to_string()))
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the backups folder: {e}"))?;
    Ok(dir)
}

fn list_in(dir: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = fs::read_dir(dir)
        .map(|it| {
            it.filter_map(Result::ok)
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let (stamp, kind) = parse_name(&name)?;
                    let size_bytes = e.metadata().ok()?.len();
                    Some(BackupInfo { name, kind, stamp, size_bytes })
                })
                .collect()
        })
        .unwrap_or_default();
    // Newest first; the stamp sorts chronologically.
    out.sort_by(|a, b| b.stamp.cmp(&a.stamp).then(b.name.cmp(&a.name)));
    out
}

/// Keeps the newest `KEEP` backups of each kind, so automatic backups can
/// never push out a manual or "before restore" backup.
fn prune(dir: &Path) {
    let all = list_in(dir);
    for kind in KINDS {
        for old in all.iter().filter(|b| b.kind == *kind).skip(KEEP) {
            let _ = fs::remove_file(dir.join(&old.name));
        }
    }
}

/// A temporary file next to `path` with a unique name.
fn temp_beside(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()))
}

/// Writes via a flushed temporary file so a crash or power cut never leaves a half-written file.
fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let tmp = temp_beside(path);
    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(contents)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| format!("Couldn't save the file: {e}"))
}

fn checked_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    parse_name(name).ok_or("Invalid backup name.")?;
    Ok(backups_dir(app)?.join(name))
}

#[tauri::command]
pub async fn backup_save(app: AppHandle, stamp: String, kind: String, contents: String) -> Result<BackupInfo, String> {
    let name = format!("{PREFIX}{stamp}-{kind}.json");
    let path = checked_path(&app, &name)?;
    write_atomic(&path, contents.as_bytes())?;
    prune(path.parent().ok_or("Invalid backup folder.")?);
    Ok(BackupInfo { size_bytes: contents.len() as u64, name, kind, stamp })
}

#[tauri::command]
pub async fn backup_list(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    Ok(list_in(&backups_dir(&app)?))
}

#[tauri::command]
pub async fn backup_read(app: AppHandle, name: String) -> Result<String, String> {
    fs::read_to_string(checked_path(&app, &name)?).map_err(|e| format!("Couldn't read the backup: {e}"))
}

#[tauri::command]
pub async fn backup_delete(app: AppHandle, name: String) -> Result<(), String> {
    fs::remove_file(checked_path(&app, &name)?).map_err(|e| format!("Couldn't delete the backup: {e}"))
}

#[tauri::command]
pub async fn backup_open_folder(app: AppHandle) -> Result<(), String> {
    let dir = backups_dir(&app)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| format!("Couldn't open the folder: {e}"))
}

// ------------------------------------------------------------ full archive

fn write_archive(path: &Path, data: &str, files_dir: &Path) -> Result<u32, String> {
    let tmp = temp_beside(path);
    let result = write_archive_to(&tmp, data, files_dir);
    match result {
        Ok(count) => fs::rename(&tmp, path).map(|_| count).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("Couldn't save the export: {e}")
        }),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

fn write_archive_to(tmp: &Path, data: &str, files_dir: &Path) -> Result<u32, String> {
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;
    let file = File::create(tmp).map_err(|e| format!("Couldn't create the export file: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated).large_file(true);
    // PDFs and images are already compressed; storing them is much faster.
    let store = SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(true);
    let err = |e: zip::result::ZipError| format!("Couldn't write the export: {e}");
    zip.start_file(DATA_ENTRY, deflate).map_err(err)?;
    zip.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    let mut count = 0;
    if let Ok(entries) = fs::read_dir(files_dir) {
        for e in entries.filter_map(Result::ok) {
            let name = e.file_name().to_string_lossy().to_string();
            if !is_valid_stored_name(&name) || !e.path().is_file() {
                continue;
            }
            zip.start_file(format!("attachments/{name}"), store).map_err(err)?;
            let mut src = File::open(e.path()).map_err(|e| format!("Couldn't read {name}: {e}"))?;
            std::io::copy(&mut src, &mut zip).map_err(|e| format!("Couldn't add {name}: {e}"))?;
            count += 1;
        }
    }
    let file = zip.finish().map_err(err)?;
    file.sync_all().map_err(|e| format!("Couldn't save the export: {e}"))?;
    Ok(count)
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveImport {
    data: String,
    files_restored: u32,
    files_skipped: u32,
}

fn read_archive(path: &Path, files_dir: &Path) -> Result<ArchiveImport, String> {
    let file = File::open(path).map_err(|e| format!("Couldn't open the file: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "This isn't a StudyOS export (not a valid ZIP file).".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("The archive has too many entries.".into());
    }
    let mut out = ArchiveImport::default();
    let mut found_data = false;
    let mut written: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("The archive is damaged: {e}"))?;
        let name = entry.name().to_string();
        if name == DATA_ENTRY {
            if entry.size() > MAX_SNAPSHOT_BYTES {
                return Err("The data in this archive is too large.".into());
            }
            let mut s = String::new();
            entry.by_ref().take(MAX_SNAPSHOT_BYTES).read_to_string(&mut s).map_err(|e| format!("Couldn't read the data: {e}"))?;
            out.data = s;
            found_data = true;
            continue;
        }
        let Some(stored) = name.strip_prefix("attachments/") else { continue };
        let dest = files_dir.join(stored);
        let declared = entry.size();
        let compressed = entry.compressed_size().max(1);
        if !is_valid_stored_name(stored) || declared > MAX_BYTES || dest.exists() || declared / compressed > MAX_RATIO || written + declared > MAX_IMPORT_BYTES {
            out.files_skipped += 1;
            continue;
        }
        // Stream to a temporary file (never the whole file in memory), checking the real size as we go.
        let tmp = temp_beside(&dest);
        let copied = (|| -> Result<Option<u64>, String> {
            let mut f = File::create(&tmp).map_err(|e| format!("Couldn't restore {stored}: {e}"))?;
            let mut head = Vec::new();
            let n = std::io::copy(&mut entry.by_ref().take(MAX_BYTES + 1), &mut HeadTee { inner: &mut f, head: &mut head }).map_err(|e| format!("Couldn't read {stored}: {e}"))?;
            // Same checks as any imported file: allowed type, size, and real content signature.
            if n > MAX_BYTES || validate(stored, n, &head).is_err() {
                return Ok(None);
            }
            f.sync_all().map_err(|e| format!("Couldn't restore {stored}: {e}"))?;
            Ok(Some(n))
        })();
        match copied {
            Ok(Some(n)) => {
                fs::rename(&tmp, &dest).map_err(|e| {
                    let _ = fs::remove_file(&tmp);
                    format!("Couldn't restore {stored}: {e}")
                })?;
                written += n;
            }
            Ok(None) => {
                let _ = fs::remove_file(&tmp);
                out.files_skipped += 1;
                continue;
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
        }
        out.files_restored += 1;
    }
    if !found_data {
        return Err("This ZIP isn't a StudyOS export (studyos-data.json is missing).".into());
    }
    Ok(out)
}

/// Writes through to a file while keeping the first 8 KB for the signature check.
struct HeadTee<'a> {
    inner: &'a mut File,
    head: &'a mut Vec<u8>,
}

impl Write for HeadTee<'_> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buf)?;
        let room = 8192usize.saturating_sub(self.head.len());
        self.head.extend_from_slice(&buf[..n.min(room)]);
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

fn has_ext(path: &Path, ext: &str) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Writes the full archive (snapshot + attachment files) to a path chosen in the save dialog.
#[tauri::command]
pub async fn archive_export(app: AppHandle, path: String, data: String) -> Result<u32, String> {
    let p = crate::paths::take_user_path(&app, &path)?;
    if !has_ext(&p, "zip") {
        return Err("Exports are saved as .zip files.".into());
    }
    let files = attachments_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_archive(&p, &data, &files)).await.map_err(|e| e.to_string())?
}

/// Reads a backup chosen in the open dialog: a .json snapshot, or a .zip export
/// (whose attachment files are restored, never overwriting existing ones).
#[tauri::command]
pub async fn backup_import_file(app: AppHandle, path: String) -> Result<ArchiveImport, String> {
    let p = crate::paths::take_user_path(&app, &path)?;
    if has_ext(&p, "json") {
        let meta = fs::metadata(&p).map_err(|e| format!("Couldn't read the file: {e}"))?;
        if meta.len() > MAX_SNAPSHOT_BYTES {
            return Err("The file is too large.".into());
        }
        let data = fs::read_to_string(&p).map_err(|e| format!("Couldn't read the file: {e}"))?;
        return Ok(ArchiveImport { data, ..Default::default() });
    }
    if !has_ext(&p, "zip") {
        return Err("Choose a StudyOS backup (.json) or export (.zip).".into());
    }
    let files = attachments_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_archive(&p, &files)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("studyos-test-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parses_only_backup_names() {
        assert_eq!(parse_name("studyos-backup-20261007-123000-auto.json"), Some(("20261007-123000".into(), "auto".into())));
        assert_eq!(parse_name("studyos-backup-20261007-123000-pre-restore.json").map(|x| x.1), Some("pre-restore".into()));
        for bad in ["studyos-backup-2026100-123000-auto.json", "studyos-backup-20261007-123000-evil.json", "../studyos-backup-20261007-123000-auto.json", "studyos-backup-20261007-123000-auto.json.exe", "x.json"] {
            assert_eq!(parse_name(bad), None, "{bad}");
        }
    }

    #[test]
    fn keeps_the_newest_fourteen() {
        let dir = temp_dir("prune");
        for day in 1..=20 {
            fs::write(dir.join(format!("{PREFIX}202610{day:02}-090000-auto.json")), "{}").unwrap();
        }
        fs::write(dir.join("notes.txt"), "keep me").unwrap();
        prune(&dir);
        let left = list_in(&dir);
        assert_eq!(left.len(), KEEP);
        assert_eq!(left[0].stamp, "20261020-090000");
        assert_eq!(left[KEEP - 1].stamp, "20261007-090000");
        assert!(dir.join("notes.txt").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn archives_round_trip_and_reject_unsafe_entries() {
        let src = temp_dir("src");
        let dst = temp_dir("dst");
        let pdf = "11111111-2222-3333-4444-555555555555.pdf";
        fs::write(src.join(pdf), b"%PDF-1.7 test").unwrap();
        fs::write(src.join("not-a-stored-name.pdf"), b"%PDF-1.7").unwrap();
        let zip_path = src.join("export.zip");
        assert_eq!(write_archive(&zip_path, "{\"format\":\"studyos-backup\"}", &src).unwrap(), 1);

        let r = read_archive(&zip_path, &dst).unwrap();
        assert_eq!(r.data, "{\"format\":\"studyos-backup\"}");
        assert_eq!((r.files_restored, r.files_skipped), (1, 0));
        assert_eq!(fs::read(dst.join(pdf)).unwrap(), b"%PDF-1.7 test");
        // Existing files are never overwritten.
        assert_eq!(read_archive(&zip_path, &dst).unwrap().files_skipped, 1);

        // A disguised executable and a path-traversal entry are skipped.
        let evil = src.join("evil.zip");
        {
            let mut z = zip::ZipWriter::new(File::create(&evil).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file(DATA_ENTRY, o).unwrap();
            z.write_all(b"{}").unwrap();
            z.start_file("attachments/aaaaaaaa-2222-3333-4444-555555555555.pdf", o).unwrap();
            z.write_all(b"MZ\x90\x00 not a pdf").unwrap();
            z.start_file("attachments/../../evil.pdf", o).unwrap();
            z.write_all(b"%PDF-").unwrap();
            z.finish().unwrap();
        }
        let r = read_archive(&evil, &dst).unwrap();
        assert_eq!((r.files_restored, r.files_skipped), (0, 2));
        assert!(!dst.join("aaaaaaaa-2222-3333-4444-555555555555.pdf").exists());

        // A ZIP without the data entry is refused.
        let empty = src.join("empty.zip");
        zip::ZipWriter::new(File::create(&empty).unwrap()).finish().unwrap();
        assert!(read_archive(&empty, &dst).is_err());
        fs::remove_dir_all(src).unwrap();
        fs::remove_dir_all(dst).unwrap();
    }
}
