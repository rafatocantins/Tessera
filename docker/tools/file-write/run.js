/**
 * file-write tool runner — writes content to a file in the sandbox workspace.
 *
 * Environment:
 *   TOOL_INPUT  JSON: { path: string, content: string, append?: boolean }
 *
 * Allowed paths: /workspace/** (mounted read-write) or /tmp/**
 *
 * Security:
 *   - Path must start with /workspace/ or /tmp/ (no directory traversal)
 *   - Max content size: 5 MB
 *   - Parent directory must exist (no recursive mkdir)
 */
"use strict";

const { writeFileSync, appendFileSync, mkdirSync, existsSync } = require("node:fs");
const { resolve, normalize, dirname } = require("node:path");

const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_ROOTS = ["/workspace", "/tmp"];

function isPathAllowed(normalizedPath) {
  return ALLOWED_ROOTS.some((root) => normalizedPath.startsWith(root + "/"));
}

function main() {
  const rawInput = process.env["TOOL_INPUT"];
  if (!rawInput) {
    process.stderr.write("TOOL_INPUT env var is missing\n");
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(rawInput);
  } catch (e) {
    process.stderr.write(`Failed to parse TOOL_INPUT as JSON: ${e.message}\n`);
    process.exit(1);
  }

  const { path: filePath, content, append = false } = input;

  if (!filePath || typeof filePath !== "string") {
    process.stderr.write("path is required and must be a string\n");
    process.exit(1);
  }

  if (typeof content !== "string") {
    process.stderr.write("content is required and must be a string\n");
    process.exit(1);
  }

  const normalizedPath = normalize(resolve(filePath));

  if (!isPathAllowed(normalizedPath)) {
    process.stderr.write(
      `Access denied: path must be within /workspace or /tmp. Got: ${normalizedPath}\n`
    );
    process.exit(1);
  }

  if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
    process.stderr.write(
      `Content too large: ${Buffer.byteLength(content, "utf-8")} bytes (max ${MAX_CONTENT_BYTES})\n`
    );
    process.exit(1);
  }

  // Ensure parent directory exists (one level only — no deep creation)
  const parentDir = dirname(normalizedPath);
  if (!existsSync(parentDir)) {
    try {
      mkdirSync(parentDir, { recursive: false });
    } catch (e) {
      process.stderr.write(`Cannot create parent directory: ${e.message}\n`);
      process.exit(1);
    }
  }

  try {
    if (append) {
      appendFileSync(normalizedPath, content, "utf-8");
    } else {
      writeFileSync(normalizedPath, content, "utf-8");
    }
  } catch (e) {
    process.stderr.write(`Failed to write file: ${e.message}\n`);
    process.exit(1);
  }

  const bytes = Buffer.byteLength(content, "utf-8");
  process.stdout.write(
    `${append ? "Appended" : "Wrote"} ${bytes} bytes to ${normalizedPath}\n`
  );
  process.exit(0);
}

main();
