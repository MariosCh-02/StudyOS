-- StudyOS migration 0002: account ownership and cloud sync bookkeeping.

-- Single-row-per-key metadata: owner_uid (account that owns the local data).
CREATE TABLE sync_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- Last version of each row known to be identical locally and in the cloud.
-- A local row whose updated_at differs from this has unsynced changes.
CREATE TABLE sync_rows (
    table_name TEXT NOT NULL,
    row_id     TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (table_name, row_id)
);

-- Per-table pull watermark: highest server-side sync time already applied.
CREATE TABLE sync_cursors (
    table_name     TEXT PRIMARY KEY NOT NULL,
    last_pulled_ms INTEGER NOT NULL DEFAULT 0
);
