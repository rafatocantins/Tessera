/**
 * marketplace.test.ts — Unit tests for MarketplaceRegistry.
 *
 * Tests publish, list (namespace/tag/search/sort), get, recordInstall,
 * and persistence behaviour.  Uses temp files for persistence tests
 * and cleans up in afterEach.
 */
import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync, writeFileSync } from "node:fs";
import { MarketplaceRegistry } from "./marketplace.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const cleanupPaths: string[] = [];

function tmpPath(label = "mp"): string {
  const p = join(
    tmpdir(),
    `tessera-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  cleanupPaths.push(p);
  return p;
}

/** Create a registry backed by a temp file that is deleted in afterEach. */
function makeRegistry(): MarketplaceRegistry {
  return new MarketplaceRegistry(tmpPath());
}

/**
 * Minimal valid manifest JSON for the marketplace.
 * MarketplaceRegistry.publish() only validates id/version (no sig check —
 * that happens in the gRPC impl layer).  Extra fields are included here so
 * list() filtering by name/description/tags works correctly.
 */
function makeManifest(
  id: string,
  version = "1.0.0",
  extras: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    id,
    version,
    name: id.split("/")[1] ?? id,
    description: `Description of ${id}`,
    tags: [],
    ...extras,
  });
}

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    if (existsSync(p)) rmSync(p);
  }
});

// ── publish ────────────────────────────────────────────────────────────────

describe("MarketplaceRegistry — publish", () => {
  it("publishes a valid manifest and returns success", () => {
    const reg = makeRegistry();
    const result = reg.publish(makeManifest("test/skill"), false);
    expect(result.success).toBe(true);
    expect(result.skill_id).toBe("test/skill");
    expect(result.version).toBe("1.0.0");
    expect(result.message).toBeTruthy();
  });

  it("rejects invalid JSON", () => {
    const reg = makeRegistry();
    const result = reg.publish("not-json", false);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Invalid manifest JSON/i);
  });

  it("rejects manifest with missing id", () => {
    const reg = makeRegistry();
    const result = reg.publish(JSON.stringify({ version: "1.0.0" }), false);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/missing id or version/i);
  });

  it("rejects manifest with missing version", () => {
    const reg = makeRegistry();
    const result = reg.publish(JSON.stringify({ id: "test/skill" }), false);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/missing id or version/i);
  });

  it("rejects a duplicate skill_id@version", () => {
    const reg = makeRegistry();
    const json = makeManifest("test/skill");
    reg.publish(json, false);
    const result = reg.publish(json, false);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already published/i);
  });

  it("records trivy_scan_passed=true and sets trivy_scan_at when scanned", () => {
    const reg = makeRegistry();
    const before = Date.now();
    reg.publish(makeManifest("test/skill"), true);
    const entry = reg.get("test/skill");
    expect(entry?.trivy_scan_passed).toBe(true);
    expect(entry?.trivy_scan_at).toBeGreaterThanOrEqual(before);
  });

  it("records trivy_scan_passed=false and trivy_scan_at=0 when not scanned", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("test/skill"), false);
    const entry = reg.get("test/skill");
    expect(entry?.trivy_scan_passed).toBe(false);
    expect(entry?.trivy_scan_at).toBe(0);
  });

  it("size increases by 1 after each successful publish", () => {
    const reg = makeRegistry();
    expect(reg.size()).toBe(0);
    reg.publish(makeManifest("ns/skill1"), false);
    expect(reg.size()).toBe(1);
    reg.publish(makeManifest("ns/skill2"), false);
    expect(reg.size()).toBe(2);
  });

  it("allows different versions of the same skill", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns/skill", "1.0.0"), false);
    const result = reg.publish(makeManifest("ns/skill", "2.0.0"), false);
    expect(result.success).toBe(true);
    expect(reg.size()).toBe(2);
  });
});

// ── list ──────────────────────────────────────────────────────────────────

describe("MarketplaceRegistry — list", () => {
  it("returns empty list when no skills published", () => {
    const reg = makeRegistry();
    expect(reg.list()).toHaveLength(0);
  });

  it("lists all published skills", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns-a/skill1"), false);
    reg.publish(makeManifest("ns-a/skill2"), false);
    reg.publish(makeManifest("ns-b/skill3"), false);
    expect(reg.list()).toHaveLength(3);
  });

  it("filters by namespace prefix", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns-a/skill1"), false);
    reg.publish(makeManifest("ns-a/skill2"), false);
    reg.publish(makeManifest("ns-b/skill3"), false);
    expect(reg.list("ns-a")).toHaveLength(2);
    expect(reg.list("ns-b")).toHaveLength(1);
    expect(reg.list("ns-c")).toHaveLength(0);
  });

  it("filters by tag", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns/skill1", "1.0.0", { tags: ["nlp", "search"] }), false);
    reg.publish(makeManifest("ns/skill2", "1.0.0", { tags: ["devops"] }), false);
    reg.publish(makeManifest("ns/skill3", "1.0.0", { tags: [] }), false);
    expect(reg.list(undefined, "nlp")).toHaveLength(1);
    expect(reg.list(undefined, "search")).toHaveLength(1);
    expect(reg.list(undefined, "devops")).toHaveLength(1);
    expect(reg.list(undefined, "missing")).toHaveLength(0);
  });

  it("filters by search string — matches id", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns/web-crawler"), false);
    reg.publish(makeManifest("ns/file-reader"), false);
    expect(reg.list(undefined, undefined, "web-crawler")).toHaveLength(1);
    expect(reg.list(undefined, undefined, "file")).toHaveLength(1);
  });

  it("filters by search string — matches name and description", () => {
    const reg = makeRegistry();
    reg.publish(
      makeManifest("ns/s1", "1.0.0", { name: "Web Scraper", description: "Scrapes websites" }),
      false
    );
    reg.publish(
      makeManifest("ns/s2", "1.0.0", { name: "File Writer", description: "Writes files to disk" }),
      false
    );
    expect(reg.list(undefined, undefined, "scrapes")).toHaveLength(1);
    expect(reg.list(undefined, undefined, "disk")).toHaveLength(1);
    expect(reg.list(undefined, undefined, "no-match")).toHaveLength(0);
  });

  it("sorts results by download_count descending", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns/low",  "1.0.0"), false);
    reg.publish(makeManifest("ns/high", "1.0.0"), false);
    reg.recordInstall("ns/high", "1.0.0");
    reg.recordInstall("ns/high", "1.0.0");
    const results = reg.list();
    expect(results[0]!.skill_id).toBe("ns/high");
    expect(results[1]!.skill_id).toBe("ns/low");
  });
});

// ── get ───────────────────────────────────────────────────────────────────

describe("MarketplaceRegistry — get", () => {
  it("returns undefined for unknown skill", () => {
    const reg = makeRegistry();
    expect(reg.get("nonexistent/skill")).toBeUndefined();
  });

  it("returns undefined for known skill with wrong version", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns/skill", "1.0.0"), false);
    expect(reg.get("ns/skill", "9.9.9")).toBeUndefined();
  });

  it("returns a specific version when asked", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns/skill", "1.0.0"), false);
    reg.publish(makeManifest("ns/skill", "2.0.0"), false);
    const entry = reg.get("ns/skill", "1.0.0");
    expect(entry?.skill_version).toBe("1.0.0");
  });

  it("returns the latest-published version when no version given", async () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("ns/skill", "1.0.0"), false);
    // Ensure the second publish gets a strictly later Date.now() value
    await new Promise<void>((r) => setTimeout(r, 2));
    reg.publish(makeManifest("ns/skill", "2.0.0"), false);
    const entry = reg.get("ns/skill");
    expect(entry?.skill_version).toBe("2.0.0");
  });

  it("manifest_json roundtrips through get", () => {
    const reg = makeRegistry();
    const json = makeManifest("ns/skill");
    reg.publish(json, false);
    const entry = reg.get("ns/skill")!;
    expect(JSON.parse(entry.manifest_json)).toMatchObject({ id: "ns/skill", version: "1.0.0" });
  });
});

// ── recordInstall ─────────────────────────────────────────────────────────

describe("MarketplaceRegistry — recordInstall", () => {
  it("increments download_count on each call", () => {
    const reg = makeRegistry();
    reg.publish(makeManifest("test/skill"), false);
    expect(reg.get("test/skill")?.download_count).toBe(0);
    reg.recordInstall("test/skill", "1.0.0");
    expect(reg.get("test/skill")?.download_count).toBe(1);
    reg.recordInstall("test/skill", "1.0.0");
    expect(reg.get("test/skill")?.download_count).toBe(2);
  });

  it("is a no-op for an unknown skill (does not throw)", () => {
    const reg = makeRegistry();
    expect(() => reg.recordInstall("nonexistent/skill", "1.0.0")).not.toThrow();
  });
});

// ── persistence ───────────────────────────────────────────────────────────

describe("MarketplaceRegistry — persistence", () => {
  it("persists entries to disk after publish", () => {
    const path = tmpPath("persist");
    const reg1 = new MarketplaceRegistry(path);
    reg1.publish(makeManifest("test/skill"), false);
    expect(existsSync(path)).toBe(true);

    const reg2 = new MarketplaceRegistry(path);
    expect(reg2.size()).toBe(1);
    expect(reg2.get("test/skill")?.skill_id).toBe("test/skill");
  });

  it("persists download_count after recordInstall", () => {
    const path = tmpPath("count");
    const reg1 = new MarketplaceRegistry(path);
    reg1.publish(makeManifest("test/skill"), false);
    reg1.recordInstall("test/skill", "1.0.0");
    reg1.recordInstall("test/skill", "1.0.0");

    const reg2 = new MarketplaceRegistry(path);
    expect(reg2.get("test/skill")?.download_count).toBe(2);
  });

  it("starts empty when registry file does not exist", () => {
    const path = tmpPath("noexist");
    const reg = new MarketplaceRegistry(path);
    expect(reg.size()).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it("recovers gracefully from a corrupt file (starts empty)", () => {
    const path = tmpPath("corrupt");
    writeFileSync(path, "{ this is not valid json }", "utf-8");
    const reg = new MarketplaceRegistry(path);
    expect(reg.size()).toBe(0);
  });

  it("multiple skills all persist and reload correctly", () => {
    const path = tmpPath("multi");
    const reg1 = new MarketplaceRegistry(path);
    reg1.publish(makeManifest("ns/skill1"), false);
    reg1.publish(makeManifest("ns/skill2", "1.0.0", { tags: ["search"] }), true);
    reg1.publish(makeManifest("ns/skill3", "2.0.0"), false);

    const reg2 = new MarketplaceRegistry(path);
    expect(reg2.size()).toBe(3);
    expect(reg2.get("ns/skill2")?.trivy_scan_passed).toBe(true);
    expect(reg2.list("ns")).toHaveLength(3);
  });
});
