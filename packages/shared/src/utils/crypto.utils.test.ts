import { describe, it, expect } from "vitest";
import {
  generateToken,
  signHmac,
  verifyHmac,
  generateSessionDelimiter,
  generateCallId,
  generateUuid,
  randomUuid,
} from "./crypto.utils.js";

describe("generateToken", () => {
  it("returns a hex string of the correct length", () => {
    const token = generateToken(32);
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it("respects custom byte count", () => {
    expect(generateToken(16)).toHaveLength(32);
    expect(generateToken(64)).toHaveLength(128);
  });

  it("produces unique tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken(16)));
    expect(tokens.size).toBe(100);
  });
});

describe("signHmac / verifyHmac", () => {
  const SECRET = "test-secret-key";

  it("produces a hex signature", () => {
    const sig = signHmac(SECRET, "hello");
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(sig.length).toBeGreaterThan(0);
  });

  it("verifies a valid signature", () => {
    const payload = "user123:1700000000000";
    const sig = signHmac(SECRET, payload);
    expect(verifyHmac(SECRET, payload, sig)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const sig = signHmac(SECRET, "user123:1700000000000");
    expect(verifyHmac(SECRET, "user456:1700000000000", sig)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const payload = "user123:1700000000000";
    const sig = signHmac(SECRET, payload);
    const tampered = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
    expect(verifyHmac(SECRET, payload, tampered)).toBe(false);
  });

  it("rejects a signature from a different secret", () => {
    const payload = "user123:1700000000000";
    const sig = signHmac("other-secret", payload);
    expect(verifyHmac(SECRET, payload, sig)).toBe(false);
  });

  it("is deterministic — same inputs produce same signature", () => {
    const sig1 = signHmac(SECRET, "payload");
    const sig2 = signHmac(SECRET, "payload");
    expect(sig1).toBe(sig2);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = signHmac(SECRET, "payload-a");
    const sig2 = signHmac(SECRET, "payload-b");
    expect(sig1).not.toBe(sig2);
  });

  it("returns false for empty signature", () => {
    const payload = "some-payload";
    expect(verifyHmac(SECRET, payload, "")).toBe(false);
  });
});

describe("generateSessionDelimiter", () => {
  it("returns a non-empty string", () => {
    const delim = generateSessionDelimiter();
    expect(typeof delim).toBe("string");
    expect(delim.length).toBeGreaterThan(0);
  });

  it("produces unique delimiters on each call", () => {
    const delims = new Set(Array.from({ length: 50 }, () => generateSessionDelimiter()));
    expect(delims.size).toBe(50);
  });
});

describe("generateCallId", () => {
  it("returns a non-empty string", () => {
    const id = generateCallId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("produces unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCallId()));
    expect(ids.size).toBe(100);
  });
});

describe("generateUuid / randomUuid", () => {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("generates a valid UUID v4", () => {
    expect(generateUuid()).toMatch(UUID_PATTERN);
    expect(randomUuid()).toMatch(UUID_PATTERN);
  });

  it("generates unique UUIDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUuid()));
    expect(ids.size).toBe(100);
  });
});
