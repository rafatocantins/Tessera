import { z } from "zod";

// ── Skill Manifest Schema ─────────────────────────────────────────────────
//
// A skill is a versioned, signed bundle of one or more tool definitions.
// Each tool declares: its sandbox image (with pinned digest), input schema,
// approval requirements, and resource limits.
//
// Trust model:
//   1. Author generates an Ed25519 key pair (generateEd25519KeyPair())
//   2. Author embeds their `public_key` (hex SPKI DER) in the manifest
//   3. Author signs the canonical JSON of the manifest *without* the
//      `signature` field (signEd25519(privateKey, canonicalJson))
//   4. Author inserts the resulting hex signature as `signature`
//   5. At install time, verifier calls verifySkillManifest() which:
//        - Re-serialises the manifest without `signature`
//        - Calls verifyEd25519(public_key, canonical, signature)
//        - Checks image digests are pinned (sha256:...)
//        - Checks skill id/version not already installed at same version

// ── Resource limits per tool ──────────────────────────────────────────────

export const SkillResourceLimitsSchema = z
  .object({
    /** Container memory cap in bytes. Default: 64 MiB */
    memory_bytes: z.number().int().positive().default(64 * 1024 * 1024),
    /** Max OS threads/processes. Default: 16 */
    pids_limit: z.number().int().positive().default(16),
    /** Max wall-clock time per execution. Default: 10 s */
    timeout_seconds: z.number().int().positive().max(300).default(10),
    /** Network access level for the container. Default: "none" */
    network: z.enum(["none", "restricted", "full"]).default("none"),
    /** Mount container filesystem read-only. Default: true */
    read_only_fs: z.boolean().default(true),
    /** Allowed host-path mounts (read-only). Default: [] */
    allowed_paths: z.array(z.string()).default([]),
  })
  .default({});

export type SkillResourceLimits = z.infer<typeof SkillResourceLimitsSchema>;

// ── Per-tool definition ───────────────────────────────────────────────────

export const SkillToolDefinitionSchema = z.object({
  /** Unique ID within this skill. Must be lowercase snake_case. */
  tool_id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "tool_id must be lowercase snake_case starting with a letter"),

  /** Human-readable description shown in the approval UI. */
  description: z.string().min(1).max(500),

  /** OCI image that runs this tool inside the sandbox. */
  image: z.object({
    /** Registry + repository, e.g. "docker.io/tessera/file-read" */
    repository: z.string().min(1),
    /** Image tag — informational only; digest is the authoritative pin. */
    tag: z.string().default("latest"),
    /**
     * Content-addressable digest. REQUIRED for security — prevents image
     * substitution attacks. Format: "sha256:<64 lowercase hex chars>".
     */
    digest: z
      .string()
      .regex(
        /^sha256:[0-9a-f]{64}$/,
        "image.digest must be sha256:<64 lowercase hex chars>"
      ),
  }),

  /**
   * JSON Schema object describing the tool's input parameters.
   * Used by the LLM to construct calls and by the sandbox runner to validate.
   */
  input_schema: z.record(z.unknown()),

  /** If true, the agent loop pauses and asks the user before running this tool. */
  requires_approval: z.boolean().default(false),

  resource_limits: SkillResourceLimitsSchema,
});

export type SkillToolDefinition = z.infer<typeof SkillToolDefinitionSchema>;

// ── Skill-level permissions (declared at install time) ────────────────────

export const SkillPermissionsSchema = z
  .object({
    /** Whether any tool in the skill may open outbound network connections. */
    network_access: z.boolean().default(false),
    /** Allowed outbound domains when network_access is true. Default: [] (none). */
    allowed_domains: z.array(z.string()).default([]),
    /** Host paths the skill's tools may read. Default: [] */
    filesystem_read: z.array(z.string()).default([]),
    /** Host paths the skill's tools may write. Default: [] */
    filesystem_write: z.array(z.string()).default([]),
    /**
     * Names of vault-managed credentials the skill needs.
     * The agent will inject these via vault before tool execution.
     */
    credential_refs: z.array(z.string()).default([]),
  })
  .default({});

export type SkillPermissions = z.infer<typeof SkillPermissionsSchema>;

// ── Full skill manifest ───────────────────────────────────────────────────

export const SkillManifestSchema = z.object({
  // ── Identity ──────────────────────────────────────────────────────────

  /**
   * Globally unique skill identifier in "namespace/name" format.
   * Namespace is typically the author's handle or org slug.
   * Example: "tessera/git-ops"
   */
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/,
      "id must be 'namespace/name' where each segment is lowercase kebab-case"
    ),

  /** Display name. */
  name: z.string().min(1).max(100),

  /**
   * Semantic version string (x.y.z).
   * The (id, version) pair must be unique in the registry.
   */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "version must be semver x.y.z"),

  /** Short description of what the skill does. */
  description: z.string().min(1).max(1000),

  // ── Author / publisher ────────────────────────────────────────────────

  author: z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  }),

  /** ISO-8601 datetime when this version was published. */
  published_at: z.string().datetime(),

  // ── Signing / trust ───────────────────────────────────────────────────

  /**
   * Hex-encoded SPKI DER Ed25519 public key.
   * Generated by `generateEd25519KeyPair()` from @tessera/shared.
   * Embedded here so the verifier can check the signature without an
   * out-of-band key lookup. Users must trust-pin this key on first install.
   */
  public_key: z
    .string()
    .regex(/^[0-9a-f]+$/, "public_key must be a non-empty lowercase hex string"),

  /**
   * 128-char hex-encoded 64-byte Ed25519 signature.
   *
   * Signing payload: `JSON.stringify(manifest, sortedKeys)` with the
   * `signature` field omitted.  The verifier must reproduce the same
   * canonical form before calling verifyEd25519().
   */
  signature: z
    .string()
    .regex(/^[0-9a-f]{128}$/, "signature must be exactly 128 lowercase hex chars (64-byte Ed25519)"),

  // ── Tools ─────────────────────────────────────────────────────────────

  /** At least one tool must be defined; max 50 per skill. */
  tools: z.array(SkillToolDefinitionSchema).min(1).max(50),

  // ── Permissions ───────────────────────────────────────────────────────

  permissions: SkillPermissionsSchema,

  // ── Optional metadata ─────────────────────────────────────────────────

  tags: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  license: z.string().optional(),
  /**
   * Minimum Tessera version required to run this skill.
   * Skills engine will reject installs if the running version is lower.
   */
  min_tessera_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/**
 * The canonical payload that is signed: the full manifest with `signature`
 * replaced by an empty string (so the field is present but neutral).
 *
 * Canonical form: `JSON.stringify(payload, Object.keys(payload).sort())`
 *
 * Rationale for sorted keys: ensures the serialisation is deterministic
 * regardless of the order properties were assigned in the author's code.
 */
export type SkillManifestPayload = Omit<SkillManifest, "signature">;

/**
 * Produce the canonical JSON string that is both signed and verified.
 * Call this before signEd25519() or verifyEd25519().
 *
 * Algorithm:
 *   1. Omit `signature` from the manifest
 *   2. JSON.stringify with sorted top-level keys (deterministic)
 */
export function canonicalSkillPayload(manifest: SkillManifest | SkillManifestPayload): string {
  // Strip signature if present
  const { signature: _sig, ...rest } = manifest as SkillManifest;
  void _sig;
  // Sort top-level keys for deterministic serialisation
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(rest).sort()) {
    sorted[key] = (rest as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted);
}
