/**
 * file-read tool runner — reads a file from the sandbox workspace.
 *
 * Environment:
 *   TOOL_INPUT  JSON: { path: string, encoding?: "utf-8" | "base64" }
 *
 * Allowed paths: /workspace/** (mounted at container start)
 *   Note: /workspace is a Docker volume shared for the session (read-only mount).
 *   Falls back to /tmp if /workspace is not mounted.
 *
 * Security:
 *   - Path must start with /workspace/ or /tmp/ (no directory traversal)
 *   - Max file size: 5 MB
 */
"use strict";

const { readFileSync, existsSync, statSync } = require("node:fs");
const { resolve, normalize } = require("node:path");

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_ROOTS = ["/workspace", "/tmp"];

function isPathAllowed(normalizedPath) {
  return ALLOWED_ROOTS.some((root) => normalizedPath.startsWith(root + "/") || normalizedPath === root);
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

  const { path: filePath, encoding = "utf-8" } = input;

  if (!filePath || typeof filePath !== "string") {
    process.stderr.write("path is required and must be a string\n");
    process.exit(1);
  }

  const normalizedPath = normalize(resolve(filePath));

  if (!isPathAllowed(normalizedPath)) {
    process.stderr.write(
      `Access denied: path must be within /workspace or /tmp. Got: ${normalizedPath}\n`
    );
    process.exit(1);
  }

  if (!existsSync(normalizedPath)) {
    process.stderr.write(`File not found: ${normalizedPath}\n`);
    process.exit(1);
  }

  let stat;
  try {
    stat = statSync(normalizedPath);
  } catch (e) {
    process.stderr.write(`Cannot stat file: ${e.message}\n`);
    process.exit(1);
  }

  if (!stat.isFile()) {
    process.stderr.write(`Not a file: ${normalizedPath}\n`);
    process.exit(1);
  }

  if (stat.size > MAX_FILE_BYTES) {
    process.stderr.write(
      `File too large: ${stat.size} bytes (max ${MAX_FILE_BYTES})\n`
    );
    process.exit(1);
  }

  let content;
  try {
    content = readFileSync(normalizedPath, { encoding: encoding === "base64" ? "base64" : "utf-8" });
  } catch (e) {
    process.stderr.write(`Failed to read file: ${e.message}\n`);
    process.exit(1);
  }

  process.stdout.write(content);
  process.exit(0);
}

main();
