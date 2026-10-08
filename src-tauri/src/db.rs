//! Database access for the frontend.
//!
//! The SQL plugin only runs migrations at start-up; the web view cannot call
//! it. Queries go through `db_select` / `db_execute`, which accept a single
//! SELECT / INSERT / UPDATE / DELETE / WITH statement (or `PRAGMA
//! table_info(...)`). That keeps script in the web view, should any ever run
//! there, from using SQLite features such as ATTACH or VACUUM INTO to write
//! files elsewhere on disk.

use serde::Serialize;
use serde_json::{Map, Value as JsonValue};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, TypeInfo, Value, ValueRef};
use tauri::{AppHandle, Manager};
use tokio::sync::OnceCell;

/// Same file as the plugin's `sqlite:studyos.db` (relative to the app config dir).
const DB_FILE: &str = "studyos.db";

static POOL: OnceCell<SqlitePool> = OnceCell::const_new();

async fn pool(app: &AppHandle) -> Result<&'static SqlitePool, String> {
    POOL.get_or_try_init(|| async {
        let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join(DB_FILE);
        // The plugin has already created and migrated the file during start-up.
        let opts = SqliteConnectOptions::new().filename(path).create_if_missing(false).foreign_keys(true);
        SqlitePoolOptions::new().max_connections(4).connect_with(opts).await.map_err(|e| format!("Could not open the StudyOS database: {e}"))
    })
    .await
}

/// Index just past the end of the statement's first `;`, ignoring quoted text
/// and comments; `None` if there is no `;`.
fn statement_end(sql: &str) -> Option<usize> {
    let b = sql.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            q @ (b'\'' | b'"' | b'`') => {
                i += 1;
                while i < b.len() {
                    if b[i] == q {
                        // A doubled quote is an escaped quote.
                        if b.get(i + 1) == Some(&q) {
                            i += 2;
                            continue;
                        }
                        break;
                    }
                    i += 1;
                }
            }
            b'[' => {
                while i < b.len() && b[i] != b']' {
                    i += 1;
                }
            }
            b'-' if b.get(i + 1) == Some(&b'-') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                i += 1;
            }
            b';' => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

fn is_blank(rest: &str) -> bool {
    let t = rest.trim();
    t.is_empty() || t.starts_with("--") && !t.contains('\n')
}

/// Accepts exactly one data statement; rejects ATTACH, VACUUM, DDL, most PRAGMAs and stacked statements.
pub(crate) fn check_sql(sql: &str) -> Result<(), String> {
    if let Some(end) = statement_end(sql) {
        if !is_blank(&sql[end..]) {
            return Err("Only one SQL statement can be run at a time.".into());
        }
    }
    let head = sql.trim_start();
    let first: String = head.chars().take_while(|c| c.is_ascii_alphabetic()).collect::<String>().to_ascii_uppercase();
    match first.as_str() {
        "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "WITH" => Ok(()),
        "PRAGMA" => {
            // Only reading a table's columns is needed by the app.
            let rest = head[6..].trim_start();
            let ok = rest.len() > 10
                && rest[..10].eq_ignore_ascii_case("table_info")
                && {
                    let args = rest[10..].trim().trim_end_matches(';').trim();
                    args.starts_with('(') && args.ends_with(')') && args[1..args.len() - 1].trim().chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                };
            if ok {
                Ok(())
            } else {
                Err("This PRAGMA is not allowed.".into())
            }
        }
        _ => Err(format!("{} statements are not allowed.", if first.is_empty() { "These" } else { &first })),
    }
}

fn bind<'q>(mut q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, params: &'q [JsonValue]) -> Result<sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, String> {
    for p in params {
        q = match p {
            JsonValue::Null => q.bind(None::<String>),
            JsonValue::Bool(b) => q.bind(*b),
            JsonValue::Number(n) => match n.as_i64() {
                Some(i) => q.bind(i),
                None => q.bind(n.as_f64().ok_or("Invalid number parameter.")?),
            },
            JsonValue::String(s) => q.bind(s.as_str()),
            _ => return Err("Query parameters must be text, numbers or null.".into()),
        };
    }
    Ok(q)
}

fn to_json(row: &SqliteRow) -> Map<String, JsonValue> {
    let mut out = Map::new();
    for col in row.columns() {
        let v = match row.try_get_raw(col.ordinal()) {
            Ok(raw) if !raw.is_null() => {
                let owned = raw.to_owned();
                match owned.type_info().name() {
                    "INTEGER" | "NUMERIC" | "BOOLEAN" => owned.try_decode::<i64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
                    "REAL" => owned.try_decode::<f64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
                    "BLOB" => JsonValue::Null, // the app stores no blobs
                    _ => owned.try_decode::<String>().map(JsonValue::String).unwrap_or(JsonValue::Null),
                }
            }
            _ => JsonValue::Null,
        };
        out.insert(col.name().to_string(), v);
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    rows_affected: u64,
}

#[tauri::command]
pub async fn db_select(app: AppHandle, sql: String, params: Vec<JsonValue>) -> Result<Vec<Map<String, JsonValue>>, String> {
    check_sql(&sql)?;
    let rows = bind(sqlx::query(&sql), &params)?.fetch_all(pool(&app).await?).await.map_err(|e| e.to_string())?;
    Ok(rows.iter().map(to_json).collect())
}

#[tauri::command]
pub async fn db_execute(app: AppHandle, sql: String, params: Vec<JsonValue>) -> Result<ExecResult, String> {
    check_sql(&sql)?;
    let r = bind(sqlx::query(&sql), &params)?.execute(pool(&app).await?).await.map_err(|e| e.to_string())?;
    Ok(ExecResult { rows_affected: r.rows_affected() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_single_data_statements() {
        for ok in [
            "SELECT * FROM notes WHERE id = $1",
            "  \n  select 1",
            "INSERT INTO t (a) VALUES ($1) ON CONFLICT (a) DO UPDATE SET a = excluded.a",
            "UPDATE notes SET title = 'a;b' WHERE id = $1;",
            "DELETE FROM sync_rows",
            "WITH x AS (SELECT 1) SELECT * FROM x",
            "SELECT 1; -- trailing comment",
            "PRAGMA table_info(notes)",
            "SELECT \"semi;colon\" FROM t /* ; */ WHERE a = 'it''s;'",
        ] {
            assert!(check_sql(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn rejects_file_writes_ddl_and_stacked_statements() {
        for bad in [
            "ATTACH DATABASE 'C:/x.bat' AS x",
            "attach 'x' as y",
            "VACUUM INTO 'C:/x.db'",
            "SELECT 1; ATTACH 'x' AS y",
            "SELECT 1;ATTACH 'x' AS y",
            "UPDATE t SET a = 1; DROP TABLE notes",
            "DROP TABLE notes",
            "CREATE TABLE x (a)",
            "PRAGMA writable_schema = 1",
            "PRAGMA table_info(notes); ATTACH 'x' AS y",
            "PRAGMA table_info('x'||'y')",
            "",
        ] {
            assert!(check_sql(bad).is_err(), "{bad}");
        }
    }
}
