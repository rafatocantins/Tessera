/**
 * connection.ts — SQLite database connection factory for the audit system.
 *
 * Uses WAL (Write-Ahead Logging) mode for better concurrent read performance.
 * The audit database is write-heavy and read-light in the critical path.
 */
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { initSchema } from "./schema.js";

export function createAuditDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });

  const db = new Database(join(dataDir, "audit.db"), {
    fileMustExist: false,
    // Verbose logging only in debug mode
    verbose: process.env["SECURECLAW_LOG_LEVEL"] === "debug"
      ? (sql) => { process.stderr.write(`[audit-sql] ${String(sql)}\n`); }
      : undefined,
  });

  // Performance and durability settings
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");  // Good durability with WAL
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -4000");    // 4 MB page cache
  db.pragma("temp_store = MEMORY");

  // Initialize schema (idempotent)
  initSchema(db);

  return db;
}
