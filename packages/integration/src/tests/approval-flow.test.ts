/**
 * approval-flow.test.ts — End-to-end tool approval flow (test #17).
 *
 * Verifies:
 *   - Sending a message whose mock LLM response contains a shell_exec tool_use
 *     causes a "tool_pending" WS event with requires_approval = true.
 *   - The pending approval appears in GET /api/v1/approvals.
 *   - Sending { type: "approve", approved: false } (deny path — no sandbox needed)
 *     causes the agent to continue and eventually emit a "complete" event.
 *   - No "error" event is received (denial is not an error).
 */
import { describe, it, expect } from "vitest";
import { GATEWAY_URL, HMAC_SECRET } from "../helpers/compose.js";
import { generateToken } from "../helpers/token.js";
import { queueScenario } from "../helpers/mock-llm.js";
import { WsTestClient } from "../helpers/ws-client.js";

const MOCK_LLM_URL = `http://127.0.0.1:${process.env["MOCK_LLM_PORT"] ?? "11435"}`;
const TEST_USER = "approval-test-user";

function token(): string {
  return generateToken(TEST_USER, HMAC_SECRET);
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${token()}` };
}

describe("approval flow (test #17)", () => {
  it("tool_pending is emitted and approval deny path completes cleanly", async () => {
    // Queue: call 1 → shell_exec tool_use, call 2 → follow-up text after denial
    await queueScenario(MOCK_LLM_URL, {
      type: "tool_use",
      toolName: "shell_exec",
      toolInput: { command: "echo integration-test" },
      followUpText: "I was not able to run the command as it was denied.",
    });

    // Create session
    const createRes = await fetch(`${GATEWAY_URL}/api/v1/sessions`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", model: "claude-3-5-haiku-20241022" }),
    });
    expect(createRes.status).toBe(201);
    const { session_id } = (await createRes.json()) as { session_id: string };

    // Connect WebSocket
    const ws = new WsTestClient();
    await ws.connect(session_id, GATEWAY_URL, token());

    // Send message
    ws.send({ type: "message", session_id, content: "Run echo integration-test please." });

    // Wait for tool_pending
    const pending = await ws.waitForType("tool_pending", 60_000);
    expect(pending.tool_id).toBe("shell_exec");
    expect(pending.requires_approval).toBe(true);
    const callId = pending.call_id as string;
    expect(callId).toBeTruthy();

    // Verify GET /api/v1/approvals shows the pending item
    const approvalsRes = await fetch(`${GATEWAY_URL}/api/v1/approvals`, {
      headers: authHeaders(),
    });
    expect(approvalsRes.status).toBe(200);
    const { approvals } = (await approvalsRes.json()) as {
      approvals: Array<{ call_id: string; session_id: string; tool_id: string }>;
    };
    const found = approvals.find((a) => a.call_id === callId);
    expect(found).toBeDefined();
    expect(found?.session_id).toBe(session_id);
    expect(found?.tool_id).toBe("shell_exec");

    // Deny the approval
    ws.send({ type: "approve", session_id, call_id: callId, approved: false });

    // Collect until complete — agent should continue with denial notice
    const msgs = await ws.collectUntil("complete", 60_000);
    ws.close();

    // No error event — denial is not an error
    const errors = msgs.filter((m) => m.type === "error");
    expect(errors).toHaveLength(0);

    // complete event received
    const complete = msgs.find((m) => m.type === "complete");
    expect(complete).toBeDefined();

    // Clean up
    await fetch(`${GATEWAY_URL}/api/v1/sessions/${session_id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).catch(() => { /* best effort */ });
  });
});
