/**
 * shell-exec tool runner — executes a shell command in the sandbox.
 *
 * Environment:
 *   TOOL_INPUT  JSON: { command: string, timeout_seconds?: number }
 *   CALL_ID     Unique call identifier for logging
 *
 * Constraints (enforced by sandbox-runtime container-config):
 *   - read-only root filesystem  (/tmp is writable tmpfs)
 *   - no capabilities
 *   - no network (network_mode: none)
 *   - runs as nobody (65534:65534)
 */
"use strict";

const { spawnSync } = require("node:child_process");

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

  const { command, timeout_seconds = 60 } = input;

  if (!command || typeof command !== "string") {
    process.stderr.write("command is required and must be a string\n");
    process.exit(1);
  }

  const result = spawnSync("/bin/sh", ["-c", command], {
    timeout: timeout_seconds * 1000,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
    cwd: "/tmp",
    encoding: "buffer",
    // Inherit no environment except safe vars
    env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp" },
  });

  if (result.stdout && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    // ETIMEDOUT from spawnSync timeout
    if (result.error.code === "ETIMEDOUT") {
      process.stderr.write(`Command timed out after ${timeout_seconds}s\n`);
      process.exit(124); // conventional timeout exit code
    }
    process.stderr.write(`spawn error: ${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main();
