import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RefStore } from "./ref-store.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let tmpDir: string;
let store: RefStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "secureclaw-refstore-"));
  store = new RefStore(tmpDir);
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("upsertRef", () => {
  it("returns a valid UUID v4 for a new service+account pair", () => {
    const refId = store.upsertRef("github", "octocat");
    expect(refId).toMatch(UUID_PATTERN);
  });

  it("returns the SAME ref_id when called again for the same pair (idempotent)", () => {
    const first = store.upsertRef("github", "octocat");
    const second = store.upsertRef("github", "octocat");
    expect(first).toBe(second);
  });

  it("returns DIFFERENT ref_ids for different service+account pairs", () => {
    const ref1 = store.upsertRef("github", "alice");
    const ref2 = store.upsertRef("github", "bob");
    const ref3 = store.upsertRef("gitlab", "alice");
    expect(ref1).not.toBe(ref2);
    expect(ref1).not.toBe(ref3);
    expect(ref2).not.toBe(ref3);
  });

  it("treats service+account as a composite unique key", () => {
    // Same account, different service → different refs
    const ref1 = store.upsertRef("service-a", "shared-account");
    const ref2 = store.upsertRef("service-b", "shared-account");
    expect(ref1).not.toBe(ref2);
  });
});

describe("getRef", () => {
  it("retrieves a ref by its ID", () => {
    const refId = store.upsertRef("aws", "prod-key");
    const ref = store.getRef(refId);

    expect(ref).not.toBeNull();
    expect(ref!.ref_id).toBe(refId);
    expect(ref!.service).toBe("aws");
    expect(ref!.account).toBe("prod-key");
  });

  it("includes a created_at timestamp string", () => {
    const refId = store.upsertRef("aws", "staging-key");
    const ref = store.getRef(refId);
    expect(typeof ref!.created_at).toBe("string");
    expect(ref!.created_at.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown ref_id", () => {
    const ref = store.getRef("00000000-0000-4000-8000-000000000000");
    expect(ref).toBeNull();
  });

  it("returns null for an empty string ref_id", () => {
    const ref = store.getRef("");
    expect(ref).toBeNull();
  });
});

describe("findRef", () => {
  it("finds a ref by service+account", () => {
    const refId = store.upsertRef("stripe", "live-secret-key");
    const found = store.findRef("stripe", "live-secret-key");

    expect(found).not.toBeNull();
    expect(found!.ref_id).toBe(refId);
  });

  it("returns null for an unknown service+account pair", () => {
    const found = store.findRef("nonexistent", "account");
    expect(found).toBeNull();
  });

  it("is case-sensitive (different casing = different pair)", () => {
    store.upsertRef("GitHub", "Alice");
    const found = store.findRef("github", "alice");
    expect(found).toBeNull(); // lowercase not found
  });
});

describe("listRefs", () => {
  it("returns an empty array when no refs exist", () => {
    expect(store.listRefs()).toHaveLength(0);
  });

  it("returns all refs after multiple upserts", () => {
    store.upsertRef("svc-a", "acc-1");
    store.upsertRef("svc-b", "acc-2");
    store.upsertRef("svc-c", "acc-3");

    const refs = store.listRefs();
    expect(refs).toHaveLength(3);
  });

  it("does not duplicate on repeated upsert of same pair", () => {
    store.upsertRef("svc", "acc");
    store.upsertRef("svc", "acc");
    store.upsertRef("svc", "acc");

    const refs = store.listRefs();
    expect(refs).toHaveLength(1);
  });

  it("includes all created refs in the list", () => {
    const r1 = store.upsertRef("svc-a", "acc");
    const r2 = store.upsertRef("svc-b", "acc");

    const ids = store.listRefs().map((r) => r.ref_id);
    expect(ids).toContain(r1);
    expect(ids).toContain(r2);
  });
});

describe("deleteRef", () => {
  it("removes an existing ref and returns true", () => {
    store.upsertRef("openai", "default");
    const deleted = store.deleteRef("openai", "default");
    expect(deleted).toBe(true);

    // Should no longer be findable
    expect(store.findRef("openai", "default")).toBeNull();
  });

  it("returns false when deleting a non-existent pair", () => {
    const deleted = store.deleteRef("ghost", "nobody");
    expect(deleted).toBe(false);
  });

  it("deletes only the targeted pair, not others", () => {
    store.upsertRef("svc", "acc-a");
    store.upsertRef("svc", "acc-b");
    store.deleteRef("svc", "acc-a");

    expect(store.findRef("svc", "acc-a")).toBeNull();
    expect(store.findRef("svc", "acc-b")).not.toBeNull();
  });

  it("after deletion, upsertRef creates a new ref_id for the same pair", () => {
    const original = store.upsertRef("svc", "acc");
    store.deleteRef("svc", "acc");
    const recreated = store.upsertRef("svc", "acc");

    // The new UUID must be different from the original
    expect(recreated).not.toBe(original);
    expect(recreated).toMatch(UUID_PATTERN);
  });
});

describe("persistence", () => {
  it("refs survive store close + reopen", () => {
    const refId = store.upsertRef("persistent-svc", "acc");
    store.close();

    // Open a fresh store on the same directory
    const store2 = new RefStore(tmpDir);
    const ref = store2.getRef(refId);
    expect(ref).not.toBeNull();
    expect(ref!.service).toBe("persistent-svc");
    store2.close();

    // Prevent afterEach from calling close() on already-closed store
    store = store2; // replace so afterEach doesn't double-close
  });
});
