-- StudyOS migration 0008: projects, research workspace and papers.

CREATE TABLE projects (
    id                TEXT PRIMARY KEY NOT NULL,
    title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
    kind              TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('ai', 'research', 'programming', 'group', 'thesis', 'other')),
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
    description       TEXT,                       -- (md)
    research_question TEXT,                       -- thesis / research projects
    course_id         TEXT REFERENCES courses (id) ON DELETE SET NULL,
    lesson_id         TEXT REFERENCES lessons (id) ON DELETE SET NULL,  -- a guided project from a learning track
    start_date        TEXT,
    due_date          TEXT,
    members           TEXT NOT NULL DEFAULT '[]', -- JSON [{ "name", "role", "email" }]
    links             TEXT NOT NULL DEFAULT '[]', -- JSON [{ "label", "url" }] (repositories, docs…)
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT
);
CREATE INDEX idx_projects_status ON projects (deleted_at, status, due_date);

CREATE TABLE project_milestones (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
    due_date   TEXT,
    done_at    TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX idx_milestones_project ON project_milestones (project_id, deleted_at, sort_order);
CREATE INDEX idx_milestones_due ON project_milestones (deleted_at, due_date);

CREATE TABLE papers (
    id          TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
    authors     TEXT NOT NULL DEFAULT '[]',   -- JSON ["Last, First", …]
    year        INTEGER,
    venue       TEXT,
    doi         TEXT,
    url         TEXT,
    abstract    TEXT,
    summary     TEXT,                         -- (md) your own summary
    entry_type  TEXT NOT NULL DEFAULT 'article', -- BibTeX entry type
    cite_key    TEXT,
    status      TEXT NOT NULL DEFAULT 'to_read' CHECK (status IN ('to_read', 'reading', 'read')),
    rating      INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_papers_status ON papers (deleted_at, status);
CREATE INDEX idx_papers_doi ON papers (doi);

-- Papers in a project's literature. id = '<project>|<paper>'.
CREATE TABLE project_papers (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    paper_id   TEXT NOT NULL REFERENCES papers (id) ON DELETE CASCADE,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX idx_project_papers_project ON project_papers (project_id, deleted_at);
CREATE INDEX idx_project_papers_paper ON project_papers (paper_id, deleted_at);

ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects (id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN project_id TEXT REFERENCES projects (id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN paper_id TEXT REFERENCES papers (id) ON DELETE SET NULL;
-- Research workspace section: question, literature, methodology, results (one note each)
-- or experiment, meeting, draft (any number).
ALTER TABLE notes ADD COLUMN section TEXT;
CREATE INDEX idx_tasks_project ON tasks (project_id, deleted_at);
CREATE INDEX idx_notes_project ON notes (project_id, deleted_at, section);
CREATE INDEX idx_notes_paper ON notes (paper_id, deleted_at);

-- Files on projects and papers: rebuild attachments with the wider owner list
-- (dropping the table drops its search triggers; they are recreated below).
CREATE TABLE attachments_v3 (
    id          TEXT PRIMARY KEY NOT NULL,
    owner_type  TEXT NOT NULL CHECK (owner_type IN ('course', 'lecture', 'note', 'assignment', 'exam', 'project', 'paper')),
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
INSERT INTO attachments_v3 (id, owner_type, owner_id, file_name, stored_name, mime_type, size_bytes, is_slides, created_at, updated_at, deleted_at)
    SELECT id, owner_type, owner_id, file_name, stored_name, mime_type, size_bytes, is_slides, created_at, updated_at, deleted_at FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_v3 RENAME TO attachments;
CREATE INDEX idx_attachments_owner ON attachments (owner_type, owner_id, deleted_at);

-- Concepts can link to papers and projects too.
CREATE TABLE knowledge_links_v2 (
    id          TEXT PRIMARY KEY NOT NULL,
    entry_id    TEXT NOT NULL REFERENCES knowledge_entries (id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('course', 'lecture', 'note', 'flashcard', 'question', 'formula', 'lesson', 'paper', 'project')),
    target_id   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
INSERT INTO knowledge_links_v2 (id, entry_id, target_type, target_id, created_at, updated_at, deleted_at)
    SELECT id, entry_id, target_type, target_id, created_at, updated_at, deleted_at FROM knowledge_links;
DROP TABLE knowledge_links;
ALTER TABLE knowledge_links_v2 RENAME TO knowledge_links;
CREATE INDEX idx_knowledge_links_entry ON knowledge_links (entry_id, deleted_at);
CREATE INDEX idx_knowledge_links_target ON knowledge_links (target_type, target_id, deleted_at);

-- Search: attachments (triggers recreated after the rebuild), projects and papers.
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
CREATE TRIGGER search_projects_ai AFTER INSERT ON projects BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'project', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.research_question, '') FROM search_docs WHERE entity_type = 'project' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_projects_au AFTER UPDATE ON projects BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'project' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'project' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'project', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.research_question, '') FROM search_docs WHERE entity_type = 'project' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_projects_ad AFTER DELETE ON projects BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'project' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'project' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'project', id FROM projects WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, COALESCE(t.description, '') || ' ' || COALESCE(t.research_question, '') FROM projects t JOIN search_docs d ON d.entity_type = 'project' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;
CREATE TRIGGER search_papers_ai AFTER INSERT ON papers BEGIN
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'paper', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.authors || ' ' || COALESCE(NEW.venue, '') || ' ' || COALESCE(NEW.doi, '') || ' ' || COALESCE(NEW.abstract, '') || ' ' || COALESCE(NEW.summary, '') FROM search_docs WHERE entity_type = 'paper' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_papers_au AFTER UPDATE ON papers BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'paper' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'paper' AND entity_id = OLD.id;
    INSERT OR IGNORE INTO search_docs (entity_type, entity_id) SELECT 'paper', NEW.id WHERE NEW.deleted_at IS NULL;
    INSERT INTO search_index (rowid, title, body)
        SELECT id, NEW.title, NEW.authors || ' ' || COALESCE(NEW.venue, '') || ' ' || COALESCE(NEW.doi, '') || ' ' || COALESCE(NEW.abstract, '') || ' ' || COALESCE(NEW.summary, '') FROM search_docs WHERE entity_type = 'paper' AND entity_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_papers_ad AFTER DELETE ON papers BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT id FROM search_docs WHERE entity_type = 'paper' AND entity_id = OLD.id);
    DELETE FROM search_docs WHERE entity_type = 'paper' AND entity_id = OLD.id;
END;
INSERT INTO search_docs (entity_type, entity_id) SELECT 'paper', id FROM papers WHERE deleted_at IS NULL;
INSERT INTO search_index (rowid, title, body) SELECT d.id, t.title, t.authors || ' ' || COALESCE(t.venue, '') || ' ' || COALESCE(t.doi, '') || ' ' || COALESCE(t.abstract, '') || ' ' || COALESCE(t.summary, '') FROM papers t JOIN search_docs d ON d.entity_type = 'paper' AND d.entity_id = t.id WHERE t.deleted_at IS NULL;
