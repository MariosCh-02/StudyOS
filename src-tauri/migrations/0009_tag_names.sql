-- StudyOS migration 0009: tag names are no longer unique in the database.
--
-- Two devices can create the same tag name under different ids (e.g. the
-- built-in "tag-exam" and a typed "#exam" → "tag:exam"). With a UNIQUE name,
-- each device then rejected the other's row on every sync. Tags with the same
-- name are now merged when read (see services/tags.ts).
--
-- Rebuilding `tags` drops it, which would cascade-delete every tag link, so
-- the links are kept aside and put back unchanged (same ids and timestamps,
-- so sync sees no change).

CREATE TABLE tag_links_keep AS SELECT * FROM tag_links;

CREATE TABLE tags_v2 (
    id         TEXT PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    color      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
INSERT INTO tags_v2 (id, name, color, created_at, updated_at, deleted_at)
    SELECT id, name, color, created_at, updated_at, deleted_at FROM tags;
DROP TABLE tags;
ALTER TABLE tags_v2 RENAME TO tags;
CREATE INDEX idx_tags_name ON tags (name, deleted_at);

DELETE FROM tag_links;
INSERT INTO tag_links SELECT * FROM tag_links_keep;
DROP TABLE tag_links_keep;
