/**
 * memory-store schema — Phase 2 stub.
 *
 * Provides per-user, per-agent persistent memory with:
 * - Vector embeddings (Phase 2: add sqlite-vss or pgvector)
 * - Semantic search
 * - TTL-based expiry
 * - Access control (user can only read own memory)
 *
 * SQLite schema is defined here so the DB can be created even in Phase 1,
 * ensuring migrations work cleanly when Phase 2 is implemented.
 */

export const MEMORY_SCHEMA_SQL = `
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS memory_entries (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    session_id  TEXT,
    content     TEXT NOT NULL,
    embedding   BLOB,                    -- future: vector embedding
    tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array
    created_at  INTEGER NOT NULL,        -- unix ms
    expires_at  INTEGER,                 -- unix ms, NULL = never
    FOREIGN KEY (user_id) REFERENCES users(id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory_entries(expires_at)
    WHERE expires_at IS NOT NULL;

  -- Phase 2: add FTS5 table for keyword search
  -- CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content=memory_entries, content_rowid=rowid);
`;
