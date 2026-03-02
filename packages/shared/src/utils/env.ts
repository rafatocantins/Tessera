/**
 * env.ts — minimal .env file loader for Tessera services.
 *
 * Reads `.env` from `process.cwd()` (the monorepo root when services are
 * started via `pnpm dev`). Only sets variables that are NOT already present
 * in the environment — shell exports always take precedence.
 *
 * No external dependencies. Supports:
 *   - KEY=value
 *   - KEY="quoted value" / KEY='single quoted'
 *   - # comments (full line and inline are stripped)
 *   - Blank lines
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load `.env` from `cwd` (defaults to `process.cwd()`) into `process.env`.
 * Safe to call multiple times — subsequent calls are no-ops if vars are
 * already set.
 */
export function loadDotenv(cwd: string = process.cwd()): void {
  const envPath = join(cwd, ".env");
  if (!existsSync(envPath)) return;

  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const raw of content.split("\n")) {
    // Strip inline comments and whitespace
    const line = raw.split("#")[0]?.trim() ?? "";
    if (!line) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    // Only set if not already in the environment (shell always wins)
    if (key in process.env) continue;

    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
