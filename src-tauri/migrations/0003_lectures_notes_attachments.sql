-- StudyOS migration 0003: lectures, notes, attachments and note templates.

CREATE TABLE lectures (
    id               TEXT PRIMARY KEY NOT NULL,
    course_id        TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
    number           INTEGER CHECK (number IS NULL OR number >= 0),
    title            TEXT NOT NULL CHECK (length(trim(title)) > 0),
    date             TEXT,                    -- YYYY-MM-DD
    start_time       TEXT,                    -- HH:MM
    lecturer         TEXT,
    links            TEXT NOT NULL DEFAULT '[]',  -- JSON [{ "label": "", "url": "" }]
    comments         TEXT,                    -- personal comments
    revision_status  TEXT NOT NULL DEFAULT 'not_reviewed'
                     CHECK (revision_status IN ('not_reviewed', 'needs_review', 'reviewed', 'mastered')),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    deleted_at       TEXT
);
CREATE INDEX idx_lectures_course ON lectures (course_id, deleted_at, number);
CREATE INDEX idx_lectures_date ON lectures (date, deleted_at);

-- Rich-text notes. A note may belong to a course, a lecture (and its course), or neither.
CREATE TABLE notes (
    id           TEXT PRIMARY KEY NOT NULL,
    course_id    TEXT REFERENCES courses (id) ON DELETE SET NULL,
    lecture_id   TEXT REFERENCES lectures (id) ON DELETE SET NULL,
    title        TEXT NOT NULL DEFAULT '',
    content      TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',  -- editor JSON
    content_text TEXT NOT NULL DEFAULT '',                            -- plain text for previews/search
    pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
);
CREATE INDEX idx_notes_course ON notes (course_id, deleted_at, updated_at);
CREATE INDEX idx_notes_lecture ON notes (lecture_id, deleted_at);
CREATE INDEX idx_notes_updated ON notes (deleted_at, pinned, updated_at);

-- File metadata. The file itself is stored only on the device that imported it
-- (%LOCALAPPDATA%\com.studyos.app\attachments\<stored_name>).
CREATE TABLE attachments (
    id          TEXT PRIMARY KEY NOT NULL,
    owner_type  TEXT NOT NULL CHECK (owner_type IN ('course', 'lecture', 'note')),
    owner_id    TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
    is_slides   INTEGER NOT NULL DEFAULT 0 CHECK (is_slides IN (0, 1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_attachments_owner ON attachments (owner_type, owner_id, deleted_at);

CREATE TABLE note_templates (
    id         TEXT PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- Crash recovery: the latest editor state not yet confirmed saved. Local only (never synced).
CREATE TABLE note_drafts (
    note_id  TEXT PRIMARY KEY NOT NULL,
    title    TEXT NOT NULL,
    content  TEXT NOT NULL,
    saved_at TEXT NOT NULL
);
