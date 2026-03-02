/**
 * verifier.test.ts — Unit tests for skill manifest verification.
 *
 * Tests the full trust chain:
 *   generate key pair → build manifest → sign → verify
 *   and all the ways verification should fail.
 */
import { describe, it, expect } from "vitest";
import {
  generateEd25519KeyPair,
  canonicalSkillPayload,
  signEd25519,
  SkillManifestSchema,
  type SkillManifest,
} from "@tessera/shared";
import { verifySkillManifest, verifySkillManifestTrusted } from "./verifier.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Builds a minimal valid manifest (unsigned) */
function buildManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    id: "tessera/test-skill",
    name: "Test Skill",
    version: "1.0.0",
    description: "A test skill for unit tests",
    author: { name: "Test Author", email: "test@example.com" },
    published_at: "2025-01-01T00:00:00.000Z",
    public_key: "aabbcc", // placeholder — replaced by signManifest()
    signature: "a".repeat(128), // placeholder — replaced by signManifest()
    tools: [
      {
        tool_id: "test_tool",
        description: "Does nothing useful",
        image: {
          repository: "docker.io/test/tool",
          tag: "latest",
          digest: "sha256:" + "a".repeat(64),
        },
        input_schema: { type: "object", properties: { input: { type: "string" } } },
        requires_approval: false,
        resource_limits: {},
      },
    ],
    permissions: {},
    tags: ["test"],
    ...overrides,
  };
}

/**
 * Signs a manifest and returns the complete signed manifest JSON.
 *
 * IMPORTANT: Zod-parse the manifest BEFORE computing the canonical payload
 * so defaults are applied — the verifier does the same thing, so signing
 * and verification must operate over the identical canonical form.
 */
function signManifest(manifest: Omit<SkillManifest, "public_key" | "signature">): string {
  const kp = generateEd25519KeyPair();
  const withPlaceholders: SkillManifest = {
    ...manifest,
    public_key: kp.publicKey,
    signature: "a".repeat(128), // temp — must be valid hex to pass schema
  } as SkillManifest;
  // Apply Zod defaults (same as what verifySkillManifest does internally)
  const parsed = SkillManifestSchema.parse(withPlaceholders);
  const canonical = canonicalSkillPayload(parsed);
  const sig = signEd25519(kp.privateKey, canonical);
  return JSON.stringify({ ...parsed, signature: sig });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("verifySkillManifest — valid manifests", () => {
  it("accepts a correctly signed minimal manifest", () => {
    const manifestJson = signManifest(buildManifest());
    const result = verifySkillManifest(manifestJson);
    expect(result.valid).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it("returns the parsed manifest on success", () => {
    const manifestJson = signManifest(buildManifest());
    const result = verifySkillManifest(manifestJson);
    expect(result.manifest?.id).toBe("tessera/test-skill");
    expect(result.manifest?.version).toBe("1.0.0");
    expect(result.manifest?.tools).toHaveLength(1);
  });

  it("accepts a manifest with multiple tools", () => {
    const base = buildManifest();
    const manifestJson = signManifest({
      ...base,
      tools: [
        ...base.tools,
        {
          tool_id: "second_tool",
          description: "Another tool",
          image: {
            repository: "docker.io/test/tool2",
            tag: "v2",
            digest: "sha256:" + "b".repeat(64),
          },
          input_schema: {},
          requires_approval: true,
          resource_limits: {},
        },
      ],
    });
    const result = verifySkillManifest(manifestJson);
    expect(result.valid).toBe(true);
    expect(result.manifest?.tools).toHaveLength(2);
  });

  it("is deterministic — same key+manifest always verifies", () => {
    const manifestJson = signManifest(buildManifest());
    for (let i = 0; i < 5; i++) {
      expect(verifySkillManifest(manifestJson).valid).toBe(true);
    }
  });
});

describe("verifySkillManifest — JSON failures", () => {
  it("rejects invalid JSON", () => {
    const result = verifySkillManifest("not json at all");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not valid JSON/i);
  });

  it("rejects an empty string", () => {
    expect(verifySkillManifest("").valid).toBe(false);
  });

  it("rejects JSON that is not an object", () => {
    expect(verifySkillManifest("[]").valid).toBe(false);
    expect(verifySkillManifest("42").valid).toBe(false);
    expect(verifySkillManifest('"string"').valid).toBe(false);
  });
});

describe("verifySkillManifest — schema validation failures", () => {
  it("rejects missing required fields", () => {
    const result = verifySkillManifest(JSON.stringify({ id: "a/b" }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation/i);
  });

  it("rejects invalid id format (no slash)", () => {
    // Build raw JSON directly — bypasses signManifest's Zod validation
    const raw = { ...buildManifest(), id: "no-slash-here" };
    const result = verifySkillManifest(JSON.stringify(raw));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation/i);
  });

  it("rejects invalid version format", () => {
    const raw = { ...buildManifest(), version: "1.0" };
    const result = verifySkillManifest(JSON.stringify(raw));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation/i);
  });

  it("rejects signature that is not 128 hex chars", () => {
    const kp = generateEd25519KeyPair();
    const manifest = { ...buildManifest(), public_key: kp.publicKey, signature: "tooshort" };
    const result = verifySkillManifest(JSON.stringify(manifest));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation/i);
  });

  it("rejects empty tools array", () => {
    const raw = { ...buildManifest(), tools: [] };
    const result = verifySkillManifest(JSON.stringify(raw));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation/i);
  });
});

describe("verifySkillManifest — image digest pin check", () => {
  it("rejects tool without sha256 digest", () => {
    // Build raw JSON with a bad digest (not sha256-prefixed) — schema catches it
    const base = buildManifest();
    const raw = {
      ...base,
      tools: [
        {
          ...base.tools[0]!,
          image: {
            repository: "docker.io/test/tool",
            tag: "latest",
            digest: "not-a-sha256-digest",
          },
        },
      ],
    };
    const result = verifySkillManifest(JSON.stringify(raw));
    expect(result.valid).toBe(false);
    // Schema catches the bad digest format first
    expect(result.error).toBeTruthy();
  });

  it("rejects digest that is sha256 but wrong length", () => {
    const base = buildManifest();
    const raw = {
      ...base,
      tools: [
        {
          ...base.tools[0]!,
          image: {
            repository: "docker.io/test/tool",
            tag: "latest",
            digest: "sha256:abc123", // too short — fails Zod regex
          },
        },
      ],
    };
    const result = verifySkillManifest(JSON.stringify(raw));
    expect(result.valid).toBe(false);
  });
});

describe("verifySkillManifest — signature failures", () => {
  it("rejects a tampered payload (field modified after signing)", () => {
    const manifestJson = signManifest(buildManifest());
    const manifest = JSON.parse(manifestJson) as SkillManifest;
    // Tamper: change description after signing
    manifest.description = "TAMPERED";
    const result = verifySkillManifest(JSON.stringify(manifest));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it("rejects a tampered signature (single character flip)", () => {
    const manifestJson = signManifest(buildManifest());
    const manifest = JSON.parse(manifestJson) as SkillManifest;
    const sig = manifest.signature;
    manifest.signature = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    const result = verifySkillManifest(JSON.stringify(manifest));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it("rejects a signature from a different key pair", () => {
    const manifestJson = signManifest(buildManifest());
    const manifest = JSON.parse(manifestJson) as SkillManifest;
    // Replace public_key with a different key while keeping the old signature
    const otherKp = generateEd25519KeyPair();
    manifest.public_key = otherKp.publicKey;
    const result = verifySkillManifest(JSON.stringify(manifest));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it("rejects a manifest where the public_key is non-hex garbage", () => {
    const manifestJson = signManifest(buildManifest());
    const manifest = JSON.parse(manifestJson) as SkillManifest;
    // Replace public_key with invalid hex — schema catches this
    manifest.public_key = "not-valid-hex!!!";
    const result = verifySkillManifest(JSON.stringify(manifest));
    expect(result.valid).toBe(false);
  });
});

describe("verifySkillManifestTrusted", () => {
  it("accepts a valid manifest whose key is in the trust set", () => {
    // signManifest already produces a correctly signed manifest
    const kp = generateEd25519KeyPair();
    const base = buildManifest();
    const withPlaceholders: SkillManifest = { ...base, public_key: kp.publicKey, signature: "a".repeat(128) };
    const parsed = SkillManifestSchema.parse(withPlaceholders);
    const canonical = canonicalSkillPayload(parsed);
    const sig = signEd25519(kp.privateKey, canonical);
    const manifestJson = JSON.stringify({ ...parsed, signature: sig });

    const trusted = new Set([kp.publicKey]);
    const result = verifySkillManifestTrusted(manifestJson, trusted);
    expect(result.valid).toBe(true);
  });

  it("rejects a valid manifest whose key is NOT in the trust set", () => {
    const manifestJson = signManifest(buildManifest());
    const trusted = new Set<string>(); // empty trust set
    const result = verifySkillManifestTrusted(manifestJson, trusted);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/trusted key/i);
  });

  it("still rejects tampered manifests even if key is trusted", () => {
    const kp = generateEd25519KeyPair();
    const base = buildManifest();
    const withPlaceholders: SkillManifest = { ...base, public_key: kp.publicKey, signature: "a".repeat(128) };
    const parsed = SkillManifestSchema.parse(withPlaceholders);
    const canonical = canonicalSkillPayload(parsed);
    const sig = signEd25519(kp.privateKey, canonical);
    const manifest = JSON.parse(JSON.stringify({ ...parsed, signature: sig })) as SkillManifest;
    // Tamper after signing
    manifest.description = "TAMPERED";

    const trusted = new Set([kp.publicKey]);
    const result = verifySkillManifestTrusted(JSON.stringify(manifest), trusted);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });
});
