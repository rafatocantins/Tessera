/**
 * verifier.ts — Skill manifest signature verification.
 *
 * Security guarantees:
 * 1. Schema validation (Zod) — rejects malformed manifests
 * 2. Ed25519 signature check — rejects manifests not signed by the declared key
 * 3. Image digest pin check — rejects tools without sha256-pinned images
 *    (prevents image substitution attacks between install and execution)
 *
 * Never throws — always returns a SkillVerificationResult.
 * Callers can rely on `valid` being false for ANY failure condition.
 */

import {
  SkillManifestSchema,
  canonicalSkillPayload,
  verifyEd25519,
  type SkillManifest,
} from "@secureclaw/shared";

// ── Result type ───────────────────────────────────────────────────────────

export interface SkillVerificationResult {
  valid: boolean;
  /** Set when valid === true */
  manifest?: SkillManifest;
  /** Human-readable failure reason when valid === false */
  error?: string;
}

// ── verifySkillManifest ───────────────────────────────────────────────────

/**
 * Parse, schema-validate, and cryptographically verify a skill manifest.
 *
 * @param manifestJson  Raw JSON string from InstallSkillRequest or disk
 * @returns             SkillVerificationResult — never throws
 */
export function verifySkillManifest(manifestJson: string): SkillVerificationResult {
  // 1. Parse JSON
  let raw: unknown;
  try {
    raw = JSON.parse(manifestJson);
  } catch {
    return { valid: false, error: "Manifest is not valid JSON" };
  }

  // 2. Schema validation
  const parsed = SkillManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { valid: false, error: `Schema validation failed: ${issues}` };
  }

  const manifest = parsed.data;

  // 3. Image digest pin check (all tools must have sha256-pinned images)
  //    This runs before the signature check so we don't accept unverifiable tools.
  for (const tool of manifest.tools) {
    if (!tool.image.digest.startsWith("sha256:")) {
      return {
        valid: false,
        error:
          `Tool "${tool.tool_id}" image digest is missing or not sha256-pinned. ` +
          `Got: "${tool.image.digest}". Required format: "sha256:<64 hex chars>".`,
      };
    }
  }

  // 4. Ed25519 signature verification
  //    Canonical payload = manifest without `signature`, top-level keys sorted.
  const canonical = canonicalSkillPayload(manifest);
  const signatureValid = verifyEd25519(manifest.public_key, canonical, manifest.signature);
  if (!signatureValid) {
    return {
      valid: false,
      error:
        "Ed25519 signature verification failed. " +
        "The manifest may have been tampered with, or the signature was generated with a different key.",
    };
  }

  return { valid: true, manifest };
}

// ── verifySkillManifestTrusted ────────────────────────────────────────────

/**
 * Verify a manifest AND check that its public key is in the caller-supplied
 * trusted key set.
 *
 * Use this for strict enforcement: users must explicitly trust-pin a key
 * before skills signed by that key can be installed.
 *
 * @param manifestJson      Raw manifest JSON
 * @param trustedPublicKeys Set of trusted hex-encoded SPKI DER public keys
 */
export function verifySkillManifestTrusted(
  manifestJson: string,
  trustedPublicKeys: ReadonlySet<string>
): SkillVerificationResult {
  const base = verifySkillManifest(manifestJson);
  if (!base.valid) return base;

  if (!trustedPublicKeys.has(base.manifest!.public_key)) {
    return {
      valid: false,
      error:
        `The skill's public key is not in the trusted key set. ` +
        `Add the key to your trust store before installing: ${base.manifest!.public_key.slice(0, 16)}...`,
    };
  }

  return base;
}
