/**
 * compose.ts — Docker Compose lifecycle helpers for integration tests.
 *
 * Applies docker-compose.dev.yml + docker-compose.test.yml so services start
 * with test-specific overrides (mock LLM URL, low cost cap, etc.).
 */
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

const COMPOSE_FILES = [
  "-f docker-compose.dev.yml",
  "-f packages/integration/docker-compose.test.yml",
].join(" ");

const BASE_CMD = `docker compose ${COMPOSE_FILES}`;

export const GATEWAY_URL =
  process.env["GATEWAY_URL"] ?? "http://127.0.0.1:18789";

export const HMAC_SECRET =
  process.env["GATEWAY_HMAC_SECRET"] ??
  "dev-insecure-hmac-secret-change-in-prod";

export function composeUp(extraEnv?: Record<string, string>): void {
  execSync(`${BASE_CMD} up -d`, {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, ...extraEnv },
  });
}

export function composeDown(): void {
  execSync(`${BASE_CMD} down -v`, {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
}

/** Poll GET /health until it returns 200 or the timeout is reached. */
export async function waitForGateway(maxMs = 90_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${GATEWAY_URL}/health`);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise<void>((r) => setTimeout(r, 1000));
  }

  throw new Error(
    `Gateway not ready after ${maxMs}ms. Last error: ${String(lastError)}`
  );
}
