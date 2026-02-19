/**
 * health.test.ts — Basic connectivity and authentication gate tests.
 *
 * These tests verify that the gateway is up and that the auth layer works
 * before the heavier flow tests run.
 */
import { describe, it, expect } from "vitest";
import { GATEWAY_URL, HMAC_SECRET } from "../helpers/compose.js";
import { generateToken } from "../helpers/token.js";

describe("gateway health", () => {
  it("GET /health returns 200", async () => {
    const res = await fetch(`${GATEWAY_URL}/health`);
    expect(res.status).toBe(200);
  });

  it("GET /health returns { status: 'ok' }", async () => {
    const res = await fetch(`${GATEWAY_URL}/health`);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("authentication gate", () => {
  it("GET /api/v1/sessions without token returns 401", async () => {
    const res = await fetch(`${GATEWAY_URL}/api/v1/sessions`);
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/sessions with invalid token returns 401", async () => {
    const res = await fetch(`${GATEWAY_URL}/api/v1/sessions`, {
      headers: { Authorization: "Bearer not.a.valid.token" },
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/sessions with valid token returns 200", async () => {
    const token = generateToken("health-test-user", HMAC_SECRET);
    const res = await fetch(`${GATEWAY_URL}/api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
