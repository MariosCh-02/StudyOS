-- StudyOS migration 0005: assignments, exams, tasks, attendance and study sessions.

CREATE TABLE assignments (
    id           TEXT PRIMARY KEY NOT NULL,
    course_id    TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
    title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
    kind         TEXT NOT NULL DEFAULT 'assignment'
                 CHECK (kind IN ('assignment', 'project', 'quiz', 'lab', 'presentation', 'participation', 'other')),
    description  TEXT,
    due_at       TEXT,                       -- YYYY-MM-DDTHH:MM
    weight       REAL CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),   -- % of course grade
    status       TEXT NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started', 'in_progress', 'submitted', 'graded')),
    score        REAL CHECK (score IS NULL OR score >= 0),
    max_score    REAL CHECK (max_score IS NULL OR max_score > 0),
    checklist    TEXT NOT NULL DEFAULT '[]', -- JSON [{ "id", "text", "done" }]
    notes        TEXT,
    submitted_at TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
);
CREATE INDEX idx_assignments_course ON assignments (course_id, deleted_at);
CREATE INDEX idx_assignments_due ON assignments (deleted_at, status, due_at);

CREATE TABLE exams (
    id               TEXT PRIMARY KEY NOT NULL,
    course_id        TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
    title            TEXT NOT NULL CHECK (length(trim(title)) > 0),
    kind             TEXT NOT NULL DEFAULT 'final' CHECK (kind IN ('midterm', 'final', 'quiz', 'oral', 'practical', 'other')),
    start_at         TEXT,                   -- YYYY-MM-DDTHH:MM
    duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    location         TEXT,
    topics           TEXT NOT NULL DEFAULT '[]',  -- JSON [{ "id", "text", "done" }]
    notes            TEXT,
    weight           REAL CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),
    score            REAL CHECK (score IS NULL OR score >= 0),
    max_score        REAL CHECK (max_score IS NULL OR max_score > 0),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    deleted_at       TEXT
);
CREATE INDEX idx_exams_course ON exams (course_id, deleted_at);
CREATE INDEX idx_exams_start ON exams (deleted_at, start_at);

CREATE TABLE tasks (
    id                TEXT PRIMARY KEY NOT NULL,
    title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
    notes             TEXT,
    course_id         TEXT REFERENCES courses (id) ON DELETE SET NULL,
    assignment_id     TEXT REFERENCES assignments (id) ON DELETE SET NULL,
    due_at            TEXT,                  -- YYYY-MM-DDTHH:MM
    priority          TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status            TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    completed_at      TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT
);
CREATE INDEX idx_tasks_status ON tasks (deleted_at, status, due_at);
CREATE INDEX idx_tasks_course ON tasks (course_id, deleted_at);

-- One record per course per class date; the latest record wins if devices disagree.
CREATE TABLE attendance (
    id         TEXT PRIMARY KEY NOT NULL,
    course_id  TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
    lecture_id TEXT REFERENCES lectures (id) ON DELETE SET NULL,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX idx_attendance_course ON attendance (course_id, deleted_at, date);

CREATE TABLE study_sessions (
    id           TEXT PRIMARY KEY NOT NULL,
    started_at   TEXT NOT NULL,              -- YYYY-MM-DDTHH:MM
    minutes      INTEGER NOT NULL CHECK (minutes > 0),
    kind         TEXT NOT NULL DEFAULT 'timer' CHECK (kind IN ('timer', 'lecture', 'manual')),
    mode         TEXT,                       -- e.g. '25/5'
    programme_id TEXT REFERENCES programmes (id) ON DELETE SET NULL,
    course_id    TEXT REFERENCES courses (id) ON DELETE SET NULL,
    lecture_id   TEXT REFERENCES lectures (id) ON DELETE SET NULL,
    task_id      TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    topic        TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
);
CREATE INDEX idx_sessions_started ON study_sessions (deleted_at, started_at);
CREATE INDEX idx_sessions_course ON study_sessions (course_id, deleted_at);

-- Allow files on assignments and exams. SQLite can't alter a CHECK constraint,
-- so the table is rebuilt with identical columns.
CREATE TABLE attachments_v2 (
    id          TEXT PRIMARY KEY NOT NULL,
    owner_type  TEXT NOT NULL CHECK (owner_type IN ('course', 'lecture', 'note', 'assignment', 'exam')),
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
INSERT INTO attachments_v2 (id, owner_type, owner_id, file_name, stored_name, mime_type, size_bytes, is_slides, created_at, updated_at, deleted_at)
    SELECT id, owner_type, owner_id, file_name, stored_name, mime_type, size_bytes, is_slides, created_at, updated_at, deleted_at FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_v2 RENAME TO attachments;
CREATE INDEX idx_attachments_owner ON attachments (owner_type, owner_id, deleted_at);
