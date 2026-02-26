/**
 * connection.ts — SQLite database connection factory for the audit system.
 *
 * Uses WAL (Write-Ahead Logging) mode for better concurrent read performance.
 * The audit database is write-heavy and read-light in the critical path.
 *
 * Uses the built-in node:sqlite module (Node.js 22.13+ / 23.4+) — no native
 * compilation required, works on all platforms without build tools.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { initSchema } from "./schema.js";

export function createAuditDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });

  const db = new DatabaseSync(join(dataDir, "audit.db"));

  // Performance and durability settings
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");  // Good durability with WAL
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA cache_size = -4000");    // 4 MB page cache
  db.exec("PRAGMA temp_store = MEMORY");

  // Initialize schema (idempotent)
  initSchema(db);

  return db;
}
