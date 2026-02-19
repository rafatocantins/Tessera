/**
 * global-setup.ts — Vitest globalSetup: starts mock LLM + Docker Compose stack
 * once for the entire integration test suite.
 *
 * Teardown: stops services (unless SKIP_COMPOSE_DOWN=1 is set — useful for
 * inspecting logs after a test failure).
 */
import { composeUp, composeDown, waitForGateway } from "../helpers/compose.js";
import { createMockLlmServer } from "../helpers/mock-llm.js";
import type { MockLlmServer } from "../helpers/mock-llm.js";

let mockLlm: MockLlmServer | null = null;

export async function setup(): Promise<void> {
  const port = parseInt(process.env["MOCK_LLM_PORT"] ?? "11435", 10);

  // Start mock LLM server first so its port is known before compose up
  mockLlm = await createMockLlmServer(port);
  process.env["MOCK_LLM_PORT"] = String(mockLlm.port);

  process.stdout.write(`[integration] Mock LLM listening on port ${mockLlm.port}\n`);

  // Start all services
  process.stdout.write("[integration] Starting Docker Compose stack…\n");
  composeUp({ MOCK_LLM_PORT: String(mockLlm.port) });

  // Wait until the gateway is accepting requests
  process.stdout.write("[integration] Waiting for gateway to be ready…\n");
  await waitForGateway();
  process.stdout.write("[integration] Gateway ready.\n");
}

export async function teardown(): Promise<void> {
  if (process.env["SKIP_COMPOSE_DOWN"] === "1") {
    process.stdout.write(
      "[integration] SKIP_COMPOSE_DOWN=1 — leaving containers running for inspection.\n"
    );
  } else {
    process.stdout.write("[integration] Stopping Docker Compose stack…\n");
    composeDown();
  }

  await mockLlm?.close();
}
