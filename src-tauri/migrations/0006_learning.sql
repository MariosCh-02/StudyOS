-- StudyOS migration 0006: learning platform.
-- Text fields marked (md) hold Markdown with $inline$ and $$block$$ LaTeX.
-- `pack_id` marks content installed from a curriculum pack (re-installing updates it).

-- Concepts that mastery is measured on (e.g. "Gradient descent").
CREATE TABLE topics (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    subject     TEXT,
    description TEXT,
    pack_id     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_topics_name ON topics (deleted_at, name);

CREATE TABLE learning_tracks (
    id          TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT,
    color       TEXT,
    pack_id     TEXT,
    pack_version INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE TABLE subjects (
    id          TEXT PRIMARY KEY NOT NULL,
    track_id    TEXT NOT NULL REFERENCES learning_tracks (id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    pack_id     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_subjects_track ON subjects (track_id, deleted_at, sort_order);

-- Levels: 1 Foundation, 2 University, 3 Advanced, 4 Challenge.
CREATE TABLE lessons (
    id                TEXT PRIMARY KEY NOT NULL,
    subject_id        TEXT NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
    level             INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
    sort_order        INTEGER NOT NULL DEFAULT 0,
    title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
    summary           TEXT,
    content           TEXT NOT NULL DEFAULT '',       -- (md) explanation and examples
    topic_id          TEXT REFERENCES topics (id) ON DELETE SET NULL,
    estimated_minutes INTEGER,
    completed_at      TEXT,
    pack_id           TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT
);
CREATE INDEX idx_lessons_subject ON lessons (subject_id, deleted_at, level, sort_order);

CREATE TABLE questions (
    id          TEXT PRIMARY KEY NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('mcq', 'numeric', 'short', 'explain', 'predict', 'matching', 'coding', 'debugging')),
    prompt      TEXT NOT NULL CHECK (length(trim(prompt)) > 0),  -- (md)
    data        TEXT NOT NULL DEFAULT '{}',                       -- JSON, shape depends on type
    explanation TEXT,                                             -- (md)
    why_wrong   TEXT,                                             -- (md) common mistake
    example     TEXT,                                             -- (md)
    hint        TEXT,                                             -- (md)
    difficulty  INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    topic_id    TEXT REFERENCES topics (id) ON DELETE SET NULL,
    lesson_id   TEXT REFERENCES lessons (id) ON DELETE SET NULL,
    subject_id  TEXT REFERENCES subjects (id) ON DELETE SET NULL,
    course_id   TEXT REFERENCES courses (id) ON DELETE SET NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    pack_id     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_questions_topic ON questions (topic_id, deleted_at);
CREATE INDEX idx_questions_lesson ON questions (lesson_id, deleted_at);
CREATE INDEX idx_questions_subject ON questions (subject_id, deleted_at);
CREATE INDEX idx_questions_course ON questions (course_id, deleted_at);

-- A practice quiz, diagnostic or review run.
CREATE TABLE quiz_sessions (
    id          TEXT PRIMARY KEY NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('practice', 'diagnostic', 'lesson', 'review', 'exam')),
    title       TEXT NOT NULL,
    config      TEXT NOT NULL DEFAULT '{}',
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    score       REAL,          -- 0..1
    answered    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_quiz_sessions_started ON quiz_sessions (deleted_at, started_at);

CREATE TABLE question_attempts (
    id          TEXT PRIMARY KEY NOT NULL,
    question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES quiz_sessions (id) ON DELETE SET NULL,
    answered_at TEXT NOT NULL,
    score       REAL NOT NULL CHECK (score >= 0 AND score <= 1),  -- 1 correct, 0 wrong, partial in between
    response    TEXT NOT NULL DEFAULT 'null',
    time_ms     INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_attempts_question ON question_attempts (question_id, deleted_at, answered_at);
CREATE INDEX idx_attempts_answered ON question_attempts (deleted_at, answered_at);

CREATE TABLE flashcards (
    id         TEXT PRIMARY KEY NOT NULL,
    front      TEXT NOT NULL CHECK (length(trim(front)) > 0),  -- (md)
    back       TEXT NOT NULL CHECK (length(trim(back)) > 0),   -- (md)
    course_id  TEXT REFERENCES courses (id) ON DELETE SET NULL,
    topic_id   TEXT REFERENCES topics (id) ON DELETE SET NULL,
    lesson_id  TEXT REFERENCES lessons (id) ON DELETE SET NULL,
    note_id    TEXT REFERENCES notes (id) ON DELETE SET NULL,
    subject_id TEXT REFERENCES subjects (id) ON DELETE SET NULL,
    tags       TEXT NOT NULL DEFAULT '[]',
    pack_id    TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX idx_flashcards_course ON flashcards (course_id, deleted_at);
CREATE INDEX idx_flashcards_topic ON flashcards (topic_id, deleted_at);

CREATE TABLE flashcard_reviews (
    id            TEXT PRIMARY KEY NOT NULL,
    card_id       TEXT NOT NULL REFERENCES flashcards (id) ON DELETE CASCADE,
    reviewed_at   TEXT NOT NULL,
    rating        TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
    interval_days INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
);
CREATE INDEX idx_card_reviews_card ON flashcard_reviews (card_id, deleted_at, reviewed_at);

-- Spaced-repetition schedule for flashcards and questions. id = '<type>:<item id>'.
CREATE TABLE srs_state (
    id            TEXT PRIMARY KEY NOT NULL,
    item_type     TEXT NOT NULL CHECK (item_type IN ('card', 'question')),
    item_id       TEXT NOT NULL,
    due_date      TEXT NOT NULL,          -- YYYY-MM-DD
    interval_days INTEGER NOT NULL,
    ease          REAL NOT NULL,
    reps          INTEGER NOT NULL,
    lapses        INTEGER NOT NULL,
    last_review   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
);
CREATE INDEX idx_srs_due ON srs_state (item_type, deleted_at, due_date);

CREATE TABLE formulas (
    id           TEXT PRIMARY KEY NOT NULL,
    title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
    latex        TEXT NOT NULL CHECK (length(trim(latex)) > 0),
    explanation  TEXT,                   -- (md)
    variables    TEXT NOT NULL DEFAULT '[]',  -- JSON [{ "symbol", "meaning" }]
    example      TEXT,                   -- (md)
    subject      TEXT,
    topic_id     TEXT REFERENCES topics (id) ON DELETE SET NULL,
    course_ids   TEXT NOT NULL DEFAULT '[]',
    note_ids     TEXT NOT NULL DEFAULT '[]',
    tags         TEXT NOT NULL DEFAULT '[]',
    pack_id      TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
);
CREATE INDEX idx_formulas_subject ON formulas (deleted_at, subject);

-- A fixed set of questions that measures knowledge across subjects.
CREATE TABLE diagnostics (
    id           TEXT PRIMARY KEY NOT NULL,
    title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description  TEXT,
    track_id     TEXT REFERENCES learning_tracks (id) ON DELETE SET NULL,
    question_ids TEXT NOT NULL DEFAULT '[]',
    pack_id      TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
);
