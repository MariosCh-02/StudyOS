-- StudyOS migration 0007: knowledge base, tags and full-text search.

-- A concept that can span courses, e.g. "Gradient descent".
CREATE TABLE knowledge_entries (
    id         TEXT PRIMARY KEY NOT NULL,
    title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
    aliases    TEXT NOT NULL DEFAULT '',   -- other names, comma-separated
    definition TEXT NOT NULL DEFAULT '',   -- (md)
    formula    TEXT,                       -- LaTeX
    intuition  TEXT,                       -- (md)
    examples   TEXT,                       -- (md)
    topic_id   TEXT REFERENCES topics (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX idx_knowledge_title ON knowledge_entries (deleted_at, title);

-- Links from a concept to anything related. id = '<entry>|<type>|<target>' so
-- the same link made on two devices is one row.
CREATE TABLE knowledge_links (
    id          TEXT PRIMARY KEY NOT NULL,
    entry_id    TEXT NOT NULL REFERENCES knowledge_entries (id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('course', 'lecture', 'note', 'flashcard', 'question', 'formula', 'lesson')),
    target_id   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_knowledge_links_entry ON knowledge_links (entry_id, deleted_at);
CREATE INDEX idx_knowledge_links_target ON knowledge_links (target_type, target_id, deleted_at);

-- Tags become syncable: soft-delete + updated_at, and links with a stable id.
ALTER TABLE tags ADD COLUMN updated_at TEXT;
ALTER TABLE tags ADD COLUMN deleted_at TEXT;
UPDATE tags SET updated_at = created_at;
DROP TABLE entity_tags;

-- id = '<tag>|<entity type>|<entity id>'. source 'inline' = derived from #hashtags in a note.
CREATE TABLE tag_links (
    id          TEXT PRIMARY KEY NOT NULL,
    tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'inline')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_tag_links_entity ON tag_links (entity_type, entity_id, deleted_at);
CREATE INDEX idx_tag_links_tag ON tag_links (tag_id, deleted_at);

-- Full-text search (local only, rebuilt by triggers; never synced).
-- search_docs gives each searchable item a stable integer rowid in the index.
CREATE TABLE search_docs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    UNIQUE (entity_type, entity_id)
);
CREATE VIRTUAL TABLE search_index USING fts4(title, body, tokenize=unicode61 'remove_diacritics=2', prefix='2,3');

-- courses
CREATE TRIGGER search_courses_ai AFTER INSERT ON courses BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'course', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.name || COALESCE(' ' || NEW.code, ''), COALESCE(NEW.lecturer, '') || ' ' || COALESCE(NEW.description, '') FROM search_docs WHERE entity_type = 'course' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_courses_au AFTER UPDATE ON courses BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'course' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'course' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'course', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.name || COALESCE(' ' || NEW.code, ''), COALESCE(NEW.lecturer, '') || ' ' || COALESCE(NEW.description, '') FROM search_docs WHERE entity_type = 'course' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_courses_ad AFTER DELETE ON courses BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'course' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'course' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'course', id FROM courses WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.name || COALESCE(' ' || t.code, ''), COALESCE(t.lecturer, '') || ' ' || COALESCE(t.description, '') FROM courses t JOIN search_docs d ON d.entity_type = 'course' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- lectures
CREATE TRIGGER search_lectures_ai AFTER INSERT ON lectures BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'lecture', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.comments, '') FROM search_docs WHERE entity_type = 'lecture' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_lectures_au AFTER UPDATE ON lectures BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'lecture' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'lecture' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'lecture', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.comments, '') FROM search_docs WHERE entity_type = 'lecture' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_lectures_ad AFTER DELETE ON lectures BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'lecture' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'lecture' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'lecture', id FROM lectures WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.comments, '') FROM lectures t JOIN search_docs d ON d.entity_type = 'lecture' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- notes
CREATE TRIGGER search_notes_ai AFTER INSERT ON notes BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'note', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.content_text FROM search_docs WHERE entity_type = 'note' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_notes_au AFTER UPDATE ON notes BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'note' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'note' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'note', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.content_text FROM search_docs WHERE entity_type = 'note' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_notes_ad AFTER DELETE ON notes BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'note' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'note' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'note', id FROM notes WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, t.content_text FROM notes t JOIN search_docs d ON d.entity_type = 'note' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- attachments
CREATE TRIGGER search_attachments_ai AFTER INSERT ON attachments BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'attachment', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.file_name, '' FROM search_docs WHERE entity_type = 'attachment' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_attachments_au AFTER UPDATE ON attachments BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'attachment' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'attachment' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'attachment', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.file_name, '' FROM search_docs WHERE entity_type = 'attachment' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_attachments_ad AFTER DELETE ON attachments BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'attachment' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'attachment' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'attachment', id FROM attachments WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.file_name, '' FROM attachments t JOIN search_docs d ON d.entity_type = 'attachment' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- assignments
CREATE TRIGGER search_assignments_ai AFTER INSERT ON assignments BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'assignment', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'assignment' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_assignments_au AFTER UPDATE ON assignments BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'assignment' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'assignment' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'assignment', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'assignment' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_assignments_ad AFTER DELETE ON assignments BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'assignment' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'assignment' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'assignment', id FROM assignments WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.description, '') || ' ' || COALESCE(t.notes, '') FROM assignments t JOIN search_docs d ON d.entity_type = 'assignment' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- exams
CREATE TRIGGER search_exams_ai AFTER INSERT ON exams BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'exam', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.location, '') || ' ' || NEW.topics FROM search_docs WHERE entity_type = 'exam' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_exams_au AFTER UPDATE ON exams BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'exam' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'exam' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'exam', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.location, '') || ' ' || NEW.topics FROM search_docs WHERE entity_type = 'exam' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_exams_ad AFTER DELETE ON exams BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'exam' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'exam' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'exam', id FROM exams WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.notes, '') || ' ' || COALESCE(t.location, '') || ' ' || t.topics FROM exams t JOIN search_docs d ON d.entity_type = 'exam' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- tasks
CREATE TRIGGER search_tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'task', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'task' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_tasks_au AFTER UPDATE ON tasks BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'task' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'task' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'task', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'task' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_tasks_ad AFTER DELETE ON tasks BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'task' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'task' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'task', id FROM tasks WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.notes, '') FROM tasks t JOIN search_docs d ON d.entity_type = 'task' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- calendar_events
CREATE TRIGGER search_calendar_events_ai AFTER INSERT ON calendar_events BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'event', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.location, '') || ' ' || COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'event' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_calendar_events_au AFTER UPDATE ON calendar_events BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'event' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'event' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'event', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.location, '') || ' ' || COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'event' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_calendar_events_ad AFTER DELETE ON calendar_events BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'event' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'event' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'event', id FROM calendar_events WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.location, '') || ' ' || COALESCE(t.notes, '') FROM calendar_events t JOIN search_docs d ON d.entity_type = 'event' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- recurring_events
CREATE TRIGGER search_recurring_events_ai AFTER INSERT ON recurring_events BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'series', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.location, '') || ' ' || COALESCE(NEW.lecturer, '') || ' ' || COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'series' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_recurring_events_au AFTER UPDATE ON recurring_events BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'series' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'series' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'series', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.location, '') || ' ' || COALESCE(NEW.lecturer, '') || ' ' || COALESCE(NEW.notes, '') FROM search_docs WHERE entity_type = 'series' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_recurring_events_ad AFTER DELETE ON recurring_events BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'series' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'series' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'series', id FROM recurring_events WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.location, '') || ' ' || COALESCE(t.lecturer, '') || ' ' || COALESCE(t.notes, '') FROM recurring_events t JOIN search_docs d ON d.entity_type = 'series' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- flashcards
CREATE TRIGGER search_flashcards_ai AFTER INSERT ON flashcards BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'flashcard', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.front, NEW.back FROM search_docs WHERE entity_type = 'flashcard' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_flashcards_au AFTER UPDATE ON flashcards BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'flashcard' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'flashcard' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'flashcard', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.front, NEW.back FROM search_docs WHERE entity_type = 'flashcard' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_flashcards_ad AFTER DELETE ON flashcards BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'flashcard' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'flashcard' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'flashcard', id FROM flashcards WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.front, t.back FROM flashcards t JOIN search_docs d ON d.entity_type = 'flashcard' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- questions
CREATE TRIGGER search_questions_ai AFTER INSERT ON questions BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'question', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.prompt, COALESCE(NEW.explanation, '') FROM search_docs WHERE entity_type = 'question' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_questions_au AFTER UPDATE ON questions BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'question' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'question' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'question', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.prompt, COALESCE(NEW.explanation, '') FROM search_docs WHERE entity_type = 'question' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_questions_ad AFTER DELETE ON questions BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'question' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'question' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'question', id FROM questions WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.prompt, COALESCE(t.explanation, '') FROM questions t JOIN search_docs d ON d.entity_type = 'question' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- formulas
CREATE TRIGGER search_formulas_ai AFTER INSERT ON formulas BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'formula', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.latex || ' ' || COALESCE(NEW.explanation, '') FROM search_docs WHERE entity_type = 'formula' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_formulas_au AFTER UPDATE ON formulas BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'formula' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'formula' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'formula', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.latex || ' ' || COALESCE(NEW.explanation, '') FROM search_docs WHERE entity_type = 'formula' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_formulas_ad AFTER DELETE ON formulas BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'formula' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'formula' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'formula', id FROM formulas WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, t.latex || ' ' || COALESCE(t.explanation, '') FROM formulas t JOIN search_docs d ON d.entity_type = 'formula' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- lessons
CREATE TRIGGER search_lessons_ai AFTER INSERT ON lessons BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'lesson', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.summary, '') || ' ' || NEW.content FROM search_docs WHERE entity_type = 'lesson' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_lessons_au AFTER UPDATE ON lessons BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'lesson' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'lesson' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'lesson', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.summary, '') || ' ' || NEW.content FROM search_docs WHERE entity_type = 'lesson' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_lessons_ad AFTER DELETE ON lessons BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'lesson' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'lesson' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'lesson', id FROM lessons WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.summary, '') || ' ' || t.content FROM lessons t JOIN search_docs d ON d.entity_type = 'lesson' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;

-- knowledge_entries
CREATE TRIGGER search_knowledge_entries_ai AFTER INSERT ON knowledge_entries BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'concept', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.aliases || ' ' || NEW.definition || ' ' || COALESCE(NEW.intuition, '') || ' ' || COALESCE(NEW.examples, '') FROM search_docs WHERE entity_type = 'concept' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_knowledge_entries_au AFTER UPDATE ON knowledge_entries BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'concept' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'concept' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'concept', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.aliases || ' ' || NEW.definition || ' ' || COALESCE(NEW.intuition, '') || ' ' || COALESCE(NEW.examples, '') FROM search_docs WHERE entity_type = 'concept' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_knowledge_entries_ad AFTER DELETE ON knowledge_entries BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'concept' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'concept' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'concept', id FROM knowledge_entries WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, t.aliases || ' ' || t.definition || ' ' || COALESCE(t.intuition, '') || ' ' || COALESCE(t.examples, '') FROM knowledge_entries t JOIN search_docs d ON d.entity_type = 'concept' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;
