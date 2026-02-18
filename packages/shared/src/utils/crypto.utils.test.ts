import { describe, it, expect } from "vitest";
import {
  generateToken,
  signHmac,
  verifyHmac,
  generateSessionDelimiter,
  generateCallId,
  generateUuid,
  randomUuid,
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
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

describe("Ed25519 — generateEd25519KeyPair / signEd25519 / verifyEd25519", () => {
  it("generates a key pair with non-empty hex strings", () => {
    const kp = generateEd25519KeyPair();
    expect(kp.publicKey).toMatch(/^[0-9a-f]+$/);
    expect(kp.privateKey).toMatch(/^[0-9a-f]+$/);
    expect(kp.publicKey.length).toBeGreaterThan(0);
    expect(kp.privateKey.length).toBeGreaterThan(0);
  });

  it("public and private keys are different", () => {
    const kp = generateEd25519KeyPair();
    expect(kp.publicKey).not.toBe(kp.privateKey);
  });

  it("generates unique key pairs on each call", () => {
    const kp1 = generateEd25519KeyPair();
    const kp2 = generateEd25519KeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });

  it("sign + verify round-trip succeeds for string data", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const manifest = JSON.stringify({ id: "skill-a", version: "1.0.0" });
    const sig = signEd25519(privateKey, manifest);
    expect(verifyEd25519(publicKey, manifest, sig)).toBe(true);
  });

  it("sign + verify round-trip succeeds for Buffer data", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const data = Buffer.from("binary skill payload \x00\xff");
    const sig = signEd25519(privateKey, data);
    expect(verifyEd25519(publicKey, data, sig)).toBe(true);
  });

  it("signature is 128 hex chars (64 bytes)", () => {
    const { privateKey } = generateEd25519KeyPair();
    const sig = signEd25519(privateKey, "test");
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it("rejects tampered data", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const original = '{"id":"skill-a","version":"1.0.0"}';
    const tampered = '{"id":"skill-a","version":"1.0.1"}'; // version bumped
    const sig = signEd25519(privateKey, original);
    expect(verifyEd25519(publicKey, tampered, sig)).toBe(false);
  });

  it("rejects tampered signature (single bit flip)", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const data = "canonical manifest json";
    const sig = signEd25519(privateKey, data);
    // Flip the last hex nibble
    const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(verifyEd25519(publicKey, data, tampered)).toBe(false);
  });

  it("rejects a signature made with a different key pair", () => {
    const kp1 = generateEd25519KeyPair();
    const kp2 = generateEd25519KeyPair();
    const data = "some manifest";
    const sig = signEd25519(kp1.privateKey, data);
    expect(verifyEd25519(kp2.publicKey, data, sig)).toBe(false);
  });

  it("rejects wrong-key type mismatch (private used as public)", () => {
    // Passing a PKCS8 DER (private) where SPKI DER (public) is expected
    // must not throw — must return false
    const { privateKey } = generateEd25519KeyPair();
    const sig = signEd25519(privateKey, "data");
    expect(verifyEd25519(privateKey, "data", sig)).toBe(false);
  });

  it("rejects empty signature", () => {
    const { publicKey } = generateEd25519KeyPair();
    expect(verifyEd25519(publicKey, "data", "")).toBe(false);
  });

  it("rejects non-hex garbage in public key", () => {
    expect(verifyEd25519("not-hex!!!", "data", "a".repeat(128))).toBe(false);
  });

  it("rejects non-hex garbage in signature", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const sig = signEd25519(privateKey, "data");
    void sig; // suppress unused
    expect(verifyEd25519(publicKey, "data", "not-hex!!!")).toBe(false);
  });

  it("rejects signature of wrong length (63 bytes)", () => {
    const { publicKey } = generateEd25519KeyPair();
    expect(verifyEd25519(publicKey, "data", "ab".repeat(63))).toBe(false);
  });

  it("signing is deterministic for the same key+data", () => {
    // Ed25519 in Node uses deterministic signing (RFC 8032)
    const { privateKey } = generateEd25519KeyPair();
    const data = "deterministic test";
    expect(signEd25519(privateKey, data)).toBe(signEd25519(privateKey, data));
  });

  it("treats string and equivalent Buffer as the same message", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const str = "hello skill";
    const buf = Buffer.from(str, "utf-8");
    const sig = signEd25519(privateKey, str);
    expect(verifyEd25519(publicKey, buf, sig)).toBe(true);
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
