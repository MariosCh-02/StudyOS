-- StudyOS migration 0004: calendar, timetable and work schedule.
--
-- Times are local wall-clock values: dates 'YYYY-MM-DD', times 'HH:MM',
-- date-times 'YYYY-MM-DDTHH:MM'. Recurring items are stored as rules and
-- expanded on demand; per-occurrence changes are stored as exceptions.

-- Weekly recurring items: classes, work shifts, study routines, ...
CREATE TABLE recurring_events (
    id             TEXT PRIMARY KEY NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('class', 'work', 'study', 'exam', 'internship', 'research', 'personal', 'other')),
    title          TEXT NOT NULL CHECK (length(trim(title)) > 0),
    course_id      TEXT REFERENCES courses (id) ON DELETE SET NULL,
    semester_id    TEXT REFERENCES semesters (id) ON DELETE SET NULL,
    weekdays       TEXT NOT NULL,          -- JSON array of ISO weekdays, 1 = Monday … 7 = Sunday
    start_time     TEXT NOT NULL,          -- HH:MM
    end_time       TEXT NOT NULL,          -- HH:MM; earlier than start_time means it ends the next day
    start_date     TEXT NOT NULL,          -- first possible occurrence
    end_date       TEXT,                   -- last possible occurrence; NULL = no end
    interval_weeks INTEGER NOT NULL DEFAULT 1 CHECK (interval_weeks BETWEEN 1 AND 8),
    location       TEXT,
    lecturer       TEXT,
    notes          TEXT,
    ics_uid        TEXT,                   -- set when imported from an .ics file
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT
);
CREATE INDEX idx_recurring_active ON recurring_events (deleted_at, start_date, end_date);
CREATE INDEX idx_recurring_course ON recurring_events (course_id, deleted_at);
CREATE INDEX idx_recurring_ics ON recurring_events (ics_uid);

-- A single occurrence of a recurring item that was cancelled or moved.
-- No uniqueness constraint: two devices may record the same exception; the
-- most recently updated one wins when expanding.
CREATE TABLE recurrence_exceptions (
    id            TEXT PRIMARY KEY NOT NULL,
    series_id     TEXT NOT NULL REFERENCES recurring_events (id) ON DELETE CASCADE,
    original_date TEXT NOT NULL,           -- the date the occurrence would have been on
    action        TEXT NOT NULL CHECK (action IN ('cancel', 'move')),
    new_start     TEXT,                    -- for 'move'
    new_end       TEXT,
    location      TEXT,                    -- optional override for 'move'
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
);
CREATE INDEX idx_exceptions_series ON recurrence_exceptions (series_id, original_date, deleted_at);

-- One-off events.
CREATE TABLE calendar_events (
    id         TEXT PRIMARY KEY NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('class', 'work', 'study', 'assignment', 'exam', 'internship', 'research', 'personal', 'other')),
    title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
    start_at   TEXT NOT NULL,              -- YYYY-MM-DDTHH:MM (all-day: YYYY-MM-DDT00:00)
    end_at     TEXT NOT NULL,              -- exclusive; all-day events end at T00:00 of the next day
    all_day    INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
    course_id  TEXT REFERENCES courses (id) ON DELETE SET NULL,
    location   TEXT,
    notes      TEXT,
    ics_uid    TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK (end_at > start_at)
);
CREATE INDEX idx_events_range ON calendar_events (deleted_at, start_at, end_at);
CREATE INDEX idx_events_course ON calendar_events (course_id, deleted_at);
CREATE INDEX idx_events_ics ON calendar_events (ics_uid);
