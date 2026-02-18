import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initSchema } from "./schema.js";

/**
 * Open (or create) the memory SQLite database.
 * Creates the data directory if it does not exist.
 * Applies WAL mode and optimised pragmas before returning.
 */
export function createMemoryDatabase(dataDir: string): Database.Database {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(join(dataDir, "memory.db"), {
    fileMustExist: false,
    verbose:
      process.env["SECURECLAW_LOG_LEVEL"] === "debug"
        ? (sql) => {
            process.stderr.write(`[memory-sql] ${String(sql)}\n`);
          }
        : undefined,
  });

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -4000"); // 4 MB
  db.pragma("temp_store = MEMORY");

  initSchema(db);
  return db;
}
