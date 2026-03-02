/**
 * scanner.ts — Plaintext secret scanner.
 *
 * Detects secrets stored in plaintext (e.g., .env files, raw config files).
 * Raises errors for definite secrets and warnings for suspicious patterns.
 * Called on startup and periodically to ensure no credentials have been
 * accidentally written to disk in plaintext.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

interface PatternConfig {
  name: string;
  pattern: RegExp;
  isDefiniteSecret: boolean;
}

const SECRET_PATTERNS: PatternConfig[] = [
  // API Keys (definite secrets)
  { name: "ANTHROPIC_API_KEY", pattern: /sk-ant-api[0-9a-zA-Z\-]{20,}/g, isDefiniteSecret: true },
  { name: "OPENAI_API_KEY", pattern: /sk-[a-zA-Z0-9]{48}/g, isDefiniteSecret: true },
  { name: "GOOGLE_API_KEY", pattern: /AIza[0-9A-Za-z\-_]{35}/g, isDefiniteSecret: true },
  { name: "AWS_ACCESS_KEY", pattern: /AKIA[0-9A-Z]{16}/g, isDefiniteSecret: true },
  { name: "GITHUB_TOKEN", pattern: /gh[pousr]_[A-Za-z0-9]{36}/g, isDefiniteSecret: true },
  { name: "PRIVATE_KEY", pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, isDefiniteSecret: true },
  // Suspicious patterns (warnings)
  {
    name: "GENERIC_API_KEY_ASSIGNMENT",
    pattern: /(api[_-]?key|apikey|api_secret|secret[_-]?key)\s*[:=]\s*["']?[a-zA-Z0-9_\-+/]{16,}["']?/gi,
    isDefiniteSecret: false
  },
  {
    name: "PASSWORD_ASSIGNMENT",
    pattern: /(password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi,
    isDefiniteSecret: false
  },
];

// File names that should never exist with secrets
const FORBIDDEN_FILES = [".env", ".env.local", ".env.production", ".env.development", "credentials.json"];
// Extensions to scan for plaintext secrets
const SCAN_EXTENSIONS = new Set([".env", ".txt", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf"]);
// Directories to skip
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".pnpm", "coverage"]);

export interface ScanResult {
  warnings: string[];
  errors: string[];
}

/**
 * Recursively scan a directory for plaintext secrets.
 * Returns errors (definite secrets) and warnings (suspicious patterns).
 */
export function scanDirectory(dirPath: string): ScanResult {
  const result: ScanResult = { warnings: [], errors: [] };
  scanRecursive(dirPath, result, 0);
  return result;
}

function scanRecursive(dirPath: string, result: ScanResult, depth: number): void {
  // Limit recursion depth to prevent symlink loops
  if (depth > 10) return;

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dirPath, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      scanRecursive(fullPath, result, depth + 1);
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      const name = basename(entry);

      // Check for forbidden file names
      if (FORBIDDEN_FILES.includes(name)) {
        result.errors.push(
          `PLAINTEXT_SECRET: .env file found at ${fullPath}. ` +
          "Store credentials in the Tessera vault instead."
        );
        continue; // Still scan the file content
      }

      // Only scan specific extensions
      if (!SCAN_EXTENSIONS.has(ext) && !FORBIDDEN_FILES.some(f => name.startsWith(f))) {
        continue;
      }

      // Read and scan file content
      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      for (const { name: patternName, pattern, isDefiniteSecret } of SECRET_PATTERNS) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          const message = `${patternName} pattern found in ${fullPath}`;
          if (isDefiniteSecret) {
            result.errors.push(`PLAINTEXT_SECRET: ${message}. Use 'tessera vault set' to store securely.`);
          } else {
            result.warnings.push(`POTENTIAL_SECRET: ${message}`);
          }
        }
      }
    }
  }
}
