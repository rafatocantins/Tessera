/**
 * cost-cap.test.ts — Daily cost cap enforcement (test #18).
 *
 * The docker-compose.test.yml sets AUDIT_COST_CAP_USD=0.001 ($0.001/day).
 * The mock LLM returns USAGE_LARGE token counts by default (~$80 cost per call),
 * which far exceeds the cap after a single message.
 *
 * Flow:
 *   1. Send one message with a unique userId.
 *      → agent-runtime records ~$80 cost to the audit service.
 *   2. Wait briefly for the fire-and-forget RecordCost gRPC call to complete.
 *   3. Send a second message with the same userId.
 *      → Gateway reads getCostSummary → cap_exceeded = true → returns error.
 *
 * Uses a dedicated userId so cost accumulation is isolated from other tests.
 */
import { describe, it, expect } from "vitest";
import { GATEWAY_URL, HMAC_SECRET } from "../helpers/compose.js";
import { generateToken } from "../helpers/token.js";
import { queueScenario } from "../helpers/mock-llm.js";
import { WsTestClient } from "../helpers/ws-client.js";

const MOCK_LLM_URL = `http://127.0.0.1:${process.env["MOCK_LLM_PORT"] ?? "11435"}`;

// Unique userId so this test's cost doesn't interfere with others
const CAP_TEST_USER = `cost-cap-test-${Date.now()}`;

function token(): string {
  return generateToken(CAP_TEST_USER, HMAC_SECRET);
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${token()}` };
}

describe("cost cap enforcement (test #18)", () => {
  it("second message from the same user is rejected when daily cap is exceeded", async () => {
    // ── First message: USAGE_LARGE default → records ~$80 cost ──────────────
    // (No explicit inputTokens/outputTokens → mock uses USAGE_LARGE)
    await queueScenario(MOCK_LLM_URL, {
      type: "text",
      content: "Sure, I can help.",
    });

    const createRes = await fetch(`${GATEWAY_URL}/api/v1/sessions`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", model: "claude-3-5-haiku-20241022" }),
    });
    expect(createRes.status).toBe(201);
    const { session_id } = (await createRes.json()) as { session_id: string };

    const ws1 = new WsTestClient();
    await ws1.connect(session_id, GATEWAY_URL, token());
    ws1.send({ type: "message", session_id, content: "First message." });

    await ws1.collectUntil("complete", 60_000);
    ws1.close();

    // ── Allow RecordCost (fire-and-forget gRPC) to reach audit-system ────────
    await new Promise<void>((r) => setTimeout(r, 1500));

    // ── Second message: should be blocked by gateway cost-cap check ──────────
    const ws2 = new WsTestClient();
    await ws2.connect(session_id, GATEWAY_URL, token());
    ws2.send({ type: "message", session_id, content: "Second message." });

    const errorMsg = await ws2.waitForType("error", 30_000);
    ws2.close();

    expect(errorMsg.code).toBe("COST_CAP_EXCEEDED");
    expect(typeof errorMsg.message).toBe("string");
    expect((errorMsg.message as string).toLowerCase()).toContain("cap");

    // Clean up
    await fetch(`${GATEWAY_URL}/api/v1/sessions/${session_id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).catch(() => { /* best effort */ });
  });
});
