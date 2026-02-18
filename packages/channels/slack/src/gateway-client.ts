/**
 * gateway-client.ts — Standalone gateway adapter for channel services.
 *
 * Intentionally has no dependency on @secureclaw/shared to avoid build-graph
 * coupling. Re-implements the 5-line token generation that matches auth.plugin.ts.
 */
import crypto from "node:crypto";
import { WebSocket } from "ws";

// ── Token generation ───────────────────────────────────────────────────────
// Matches auth.plugin.ts generateGatewayToken: {userId}.{timestamp_ms}.{hmac}

export function generateToken(userId: string, secret: string): string {
  const ts = Date.now().toString();
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${ts}`)
    .digest("hex");
  return `${userId}.${ts}.${sig}`;
}

// ── Session management ─────────────────────────────────────────────────────

export async function createSession(
  gatewayUrl: string,
  token: string
): Promise<string> {
  const res = await fetch(`${gatewayUrl}/api/v1/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider: "claude", metadata: {} }),
  });

  if (!res.ok) {
    throw new Error(
      `createSession failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as { session_id: string };
  return data.session_id;
}

// ── WebSocket connection ───────────────────────────────────────────────────

export function openChat(
  gatewayUrl: string,
  sessionId: string,
  token: string
): WebSocket {
  const wsUrl = gatewayUrl.replace(/^http/, "ws") + `/api/v1/chat/${sessionId}`;
  return new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── Session teardown ───────────────────────────────────────────────────────
// Fire-and-forget — channel teardown should not block.

export function terminateSession(
  gatewayUrl: string,
  sessionId: string,
  token: string
): void {
  fetch(`${gatewayUrl}/api/v1/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    // Ignore — session will time out on the server side
  });
}
