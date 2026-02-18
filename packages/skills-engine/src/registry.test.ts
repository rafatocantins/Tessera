/**
 * registry.test.ts — Unit tests for SkillRegistry.
 *
 * Registry tests use in-memory mode (no persistPath) to avoid filesystem
 * side effects. Persistence behaviour is tested separately via a temp file.
 */
import { describe, it, expect } from "vitest";
import {
  generateEd25519KeyPair,
  canonicalSkillPayload,
  signEd25519,
  SkillManifestSchema,
  type SkillManifest,
} from "@secureclaw/shared";
import { SkillRegistry } from "./registry.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSignedManifestJson(overrides: Partial<SkillManifest> = {}): string {
  const kp = generateEd25519KeyPair();
  const base: SkillManifest = {
    id: "test/skill",
    name: "Test Skill",
    version: "1.0.0",
    description: "A test skill",
    author: { name: "Test Author" },
    published_at: "2025-01-01T00:00:00.000Z",
    public_key: kp.publicKey,
    signature: "a".repeat(128),
    tools: [
      {
        tool_id: "do_thing",
        description: "Does a thing",
        image: {
          repository: "docker.io/test/skill",
          tag: "latest",
          digest: "sha256:" + "a".repeat(64),
        },
        input_schema: {},
        requires_approval: false,
        resource_limits: {},
      },
    ],
    permissions: {},
    tags: [],
    ...overrides,
  };
  // Apply Zod defaults before signing — must match what the verifier does
  const parsed = SkillManifestSchema.parse(base);
  const canonical = canonicalSkillPayload(parsed);
  const sig = signEd25519(kp.privateKey, canonical);
  return JSON.stringify({ ...parsed, signature: sig });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SkillRegistry — install", () => {
  it("installs a valid skill and returns success", () => {
    const registry = new SkillRegistry();
    const result = registry.install(makeSignedManifestJson());
    expect(result.success).toBe(true);
    expect(result.skill_id).toBe("test/skill");
    expect(result.skill_version).toBe("1.0.0");
    expect(result.tools_registered).toBe(1);
  });

  it("rejects invalid JSON", () => {
    const registry = new SkillRegistry();
    const result = registry.install("not json");
    expect(result.success).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("rejects a tampered manifest", () => {
    const registry = new SkillRegistry();
    const json = makeSignedManifestJson();
    const manifest = JSON.parse(json) as SkillManifest;
    manifest.description = "TAMPERED";
    const result = registry.install(JSON.stringify(manifest));
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate (id, version) without force", () => {
    const registry = new SkillRegistry();
    const json = makeSignedManifestJson();
    registry.install(json);
    const result = registry.install(json);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already installed/i);
  });

  it("allows force-replace of an existing (id, version)", () => {
    const registry = new SkillRegistry();
    const json = makeSignedManifestJson();
    registry.install(json);
    const result = registry.install(json, true);
    expect(result.success).toBe(true);
    expect(registry.size()).toBe(1); // still just one entry
  });

  it("allows different versions of the same skill", () => {
    const registry = new SkillRegistry();
    const kp = generateEd25519KeyPair();
    const makeVersioned = (version: string): string => {
      const base: SkillManifest = {
        id: "test/skill",
        name: "Test Skill",
        version,
        description: "A test skill",
        author: { name: "Test Author" },
        published_at: "2025-01-01T00:00:00.000Z",
        public_key: kp.publicKey,
        signature: "a".repeat(128),
        tools: [{
          tool_id: "do_thing",
          description: "Does a thing",
          image: { repository: "docker.io/test/skill", tag: "latest", digest: "sha256:" + "a".repeat(64) },
          input_schema: {},
          requires_approval: false,
          resource_limits: {},
        }],
        permissions: {},
        tags: [],
      };
      const parsed = SkillManifestSchema.parse(base);
      const sig = signEd25519(kp.privateKey, canonicalSkillPayload(parsed));
      return JSON.stringify({ ...parsed, signature: sig });
    };

    registry.install(makeVersioned("1.0.0"));
    registry.install(makeVersioned("1.1.0"));
    registry.install(makeVersioned("2.0.0"));

    expect(registry.size()).toBe(3);
  });
});

describe("SkillRegistry — list", () => {
  it("returns empty list when no skills installed", () => {
    const registry = new SkillRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  it("lists all installed skills", () => {
    const registry = new SkillRegistry();
    const kp = generateEd25519KeyPair();

    const make = (id: string, version: string, tags: string[]): string => {
      const base: SkillManifest = {
        id,
        name: id,
        version,
        description: `Skill ${id}`,
        author: { name: "Author" },
        published_at: "2025-01-01T00:00:00.000Z",
        public_key: kp.publicKey,
        signature: "a".repeat(128),
        tools: [{
          tool_id: "t",
          description: "t",
          image: { repository: "r", tag: "t", digest: "sha256:" + "a".repeat(64) },
          input_schema: {},
          requires_approval: false,
          resource_limits: {},
        }],
        permissions: {},
        tags,
      };
      const parsed = SkillManifestSchema.parse(base);
      const sig = signEd25519(kp.privateKey, canonicalSkillPayload(parsed));
      return JSON.stringify({ ...parsed, signature: sig });
    };

    registry.install(make("ns-a/skill1", "1.0.0", ["ns-a"]));
    registry.install(make("ns-a/skill2", "1.0.0", ["ns-a"]));
    registry.install(make("ns-b/skill3", "1.0.0", ["ns-b"])); // different tag

    expect(registry.list()).toHaveLength(3);
    expect(registry.list("ns-a")).toHaveLength(2); // namespace filter
    expect(registry.list("ns-b")).toHaveLength(1); // namespace filter
    expect(registry.list("ns-c")).toHaveLength(0); // namespace filter — no match
    expect(registry.list(undefined, "ns-a")).toHaveLength(2); // tag filter
  });
});

describe("SkillRegistry — get", () => {
  it("returns undefined for unknown skill", () => {
    const registry = new SkillRegistry();
    expect(registry.get("nonexistent/skill")).toBeUndefined();
  });

  it("gets a specific version", () => {
    const registry = new SkillRegistry();
    registry.install(makeSignedManifestJson());
    const skill = registry.get("test/skill", "1.0.0");
    expect(skill?.manifest.id).toBe("test/skill");
    expect(skill?.manifest.version).toBe("1.0.0");
  });

  it("returns latest version when no version specified", () => {
    const registry = new SkillRegistry();
    const kp = generateEd25519KeyPair();
    const make = (version: string): string => {
      const base: SkillManifest = {
        id: "test/skill",
        name: "Test",
        version,
        description: "desc",
        author: { name: "Author" },
        published_at: "2025-01-01T00:00:00.000Z",
        public_key: kp.publicKey,
        signature: "a".repeat(128),
        tools: [{
          tool_id: "t",
          description: "t",
          image: { repository: "r", tag: "t", digest: "sha256:" + "a".repeat(64) },
          input_schema: {},
          requires_approval: false,
          resource_limits: {},
        }],
        permissions: {},
        tags: [],
      };
      const parsed = SkillManifestSchema.parse(base);
      const sig = signEd25519(kp.privateKey, canonicalSkillPayload(parsed));
      return JSON.stringify({ ...parsed, signature: sig });
    };

    registry.install(make("1.0.0"));
    registry.install(make("2.1.0"));
    registry.install(make("1.9.9"));

    const latest = registry.get("test/skill");
    expect(latest?.manifest.version).toBe("2.1.0");
  });
});

describe("SkillRegistry — remove", () => {
  it("removes a specific version", () => {
    const registry = new SkillRegistry();
    registry.install(makeSignedManifestJson());
    const result = registry.remove("test/skill", "1.0.0");
    expect(result.success).toBe(true);
    expect(result.versions_removed).toBe(1);
    expect(registry.size()).toBe(0);
  });

  it("returns failure for non-existent skill", () => {
    const registry = new SkillRegistry();
    const result = registry.remove("nonexistent/skill");
    expect(result.success).toBe(false);
    expect(result.versions_removed).toBe(0);
  });

  it("removes all versions when version not specified", () => {
    const registry = new SkillRegistry();
    const kp = generateEd25519KeyPair();
    const make = (version: string): string => {
      const base: SkillManifest = {
        id: "test/skill",
        name: "Test",
        version,
        description: "desc",
        author: { name: "Author" },
        published_at: "2025-01-01T00:00:00.000Z",
        public_key: kp.publicKey,
        signature: "a".repeat(128),
        tools: [{
          tool_id: "t",
          description: "t",
          image: { repository: "r", tag: "t", digest: "sha256:" + "a".repeat(64) },
          input_schema: {},
          requires_approval: false,
          resource_limits: {},
        }],
        permissions: {},
        tags: [],
      };
      const parsed = SkillManifestSchema.parse(base);
      const sig = signEd25519(kp.privateKey, canonicalSkillPayload(parsed));
      return JSON.stringify({ ...parsed, signature: sig });
    };

    registry.install(make("1.0.0"));
    registry.install(make("2.0.0"));
    const result = registry.remove("test/skill");
    expect(result.success).toBe(true);
    expect(result.versions_removed).toBe(2);
    expect(registry.size()).toBe(0);
  });
});

describe("SkillRegistry — getTool", () => {
  it("returns the tool definition for an installed skill", () => {
    const registry = new SkillRegistry();
    registry.install(makeSignedManifestJson());
    const entry = registry.getTool("test/skill", "1.0.0", "do_thing");
    expect(entry).toBeDefined();
    expect(entry?.tool.tool_id).toBe("do_thing");
  });

  it("returns undefined for unknown tool", () => {
    const registry = new SkillRegistry();
    registry.install(makeSignedManifestJson());
    expect(registry.getTool("test/skill", "1.0.0", "nonexistent_tool")).toBeUndefined();
  });

  it("returns undefined for unknown skill", () => {
    const registry = new SkillRegistry();
    expect(registry.getTool("nonexistent/skill", "1.0.0", "t")).toBeUndefined();
  });
});

describe("SkillRegistry — getAllToolDefinitions", () => {
  it("returns all tools from all installed skills", () => {
    const registry = new SkillRegistry();
    registry.install(makeSignedManifestJson());
    const defs = registry.getAllToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.tool.tool_id).toBe("do_thing");
    expect(defs[0]?.skill_id).toBe("test/skill");
  });

  it("returns empty array when no skills installed", () => {
    const registry = new SkillRegistry();
    expect(registry.getAllToolDefinitions()).toHaveLength(0);
  });
});

describe("SkillRegistry — persistence", () => {
  it("persists and loads from disk", () => {
    const path = join(tmpdir(), `secureclaw-test-registry-${Date.now()}.json`);
    try {
      // Write
      const registry1 = new SkillRegistry(path);
      registry1.install(makeSignedManifestJson());
      expect(existsSync(path)).toBe(true);

      // Read back — manifest is re-verified on load
      const registry2 = new SkillRegistry(path);
      expect(registry2.size()).toBe(1);
      expect(registry2.get("test/skill", "1.0.0")?.manifest.id).toBe("test/skill");
    } finally {
      if (existsSync(path)) rmSync(path);
    }
  });

  it("starts empty when registry file does not exist", () => {
    const path = join(tmpdir(), `secureclaw-nonexistent-${Date.now()}.json`);
    const registry = new SkillRegistry(path);
    expect(registry.size()).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it("updates the file after remove", () => {
    const path = join(tmpdir(), `secureclaw-test-remove-${Date.now()}.json`);
    try {
      const registry = new SkillRegistry(path);
      registry.install(makeSignedManifestJson());
      registry.remove("test/skill", "1.0.0");

      // Reload — should be empty
      const registry2 = new SkillRegistry(path);
      expect(registry2.size()).toBe(0);
    } finally {
      if (existsSync(path)) rmSync(path);
    }
  });
});
