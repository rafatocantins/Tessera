/**
 * message-loop.test.ts — End-to-end message flow (test #16).
 *
 * Verifies the full path: REST session create → WebSocket connect → message
 * send → LLM response chunks → complete event with cost data.
 *
 * The mock LLM returns a plain text response (small token counts so this test
 * does NOT exhaust the cost cap for subsequent tests).
 */
import { describe, it, expect, afterEach } from "vitest";
import { GATEWAY_URL, HMAC_SECRET } from "../helpers/compose.js";
import { generateToken } from "../helpers/token.js";
import { queueScenario } from "../helpers/mock-llm.js";
import { WsTestClient } from "../helpers/ws-client.js";

const MOCK_LLM_URL = `http://127.0.0.1:${process.env["MOCK_LLM_PORT"] ?? "11435"}`;

async function authHeaders(): Promise<HeadersInit> {
  return { Authorization: `Bearer ${generateToken("loop-test-user", HMAC_SECRET)}` };
}

let createdSessionId: string | null = null;

afterEach(async () => {
  // Clean up session so other tests don't see stale data
  if (createdSessionId) {
    const token = generateToken("loop-test-user", HMAC_SECRET);
    await fetch(`${GATEWAY_URL}/api/v1/sessions/${createdSessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => { /* best effort */ });
    createdSessionId = null;
  }
});

describe("message loop (test #16)", () => {
  it("creates a session and receives a complete event with cost data", async () => {
    // Queue a text response with small token counts to avoid hitting cost cap
    await queueScenario(MOCK_LLM_URL, {
      type: "text",
      content: "Hello! I can help you with that.",
      inputTokens: 50,
      outputTokens: 10,
    });

    // 1. Create session
    const createRes = await fetch(`${GATEWAY_URL}/api/v1/sessions`, {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", model: "claude-3-5-haiku-20241022" }),
    });
    expect(createRes.status).toBe(201);
    const { session_id } = (await createRes.json()) as { session_id: string };
    createdSessionId = session_id;
    expect(session_id).toBeTruthy();

    // 2. Connect WebSocket and send a message
    const token = generateToken("loop-test-user", HMAC_SECRET);
    const ws = new WsTestClient();
    await ws.connect(session_id, GATEWAY_URL, token);

    ws.send({ type: "message", session_id, content: "Say hello." });

    // 3. Collect until complete
    const msgs = await ws.collectUntil("complete", 60_000);
    ws.close();

    // 4. Assertions
    const chunks = msgs.filter((m) => m.type === "chunk");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((m) => typeof m.delta === "string" && m.delta.length > 0)).toBe(true);

    const complete = msgs.find((m) => m.type === "complete");
    expect(complete).toBeDefined();
    expect(typeof complete!.cost_usd).toBe("number");
    expect(complete!.cost_usd as number).toBeGreaterThan(0);
    expect(typeof complete!.input_tokens).toBe("number");
    expect(typeof complete!.output_tokens).toBe("number");
  });

  it("GET /api/v1/sessions includes the created session", async () => {
    // Quick sanity check — create a session then list it
    await queueScenario(MOCK_LLM_URL, {
      type: "text",
      content: "Ready.",
      inputTokens: 10,
      outputTokens: 2,
    });

    const createRes = await fetch(`${GATEWAY_URL}/api/v1/sessions`, {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", model: "claude-3-5-haiku-20241022" }),
    });
    const { session_id } = (await createRes.json()) as { session_id: string };
    createdSessionId = session_id;

    const listRes = await fetch(`${GATEWAY_URL}/api/v1/sessions`, {
      headers: await authHeaders(),
    });
    expect(listRes.status).toBe(200);
    const { sessions } = (await listRes.json()) as { sessions: Array<{ session_id: string }> };
    expect(sessions.some((s) => s.session_id === session_id)).toBe(true);
  });
});
