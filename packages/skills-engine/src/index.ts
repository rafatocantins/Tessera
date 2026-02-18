/**
 * skills-engine — Phase 2 stub.
 *
 * Skills are composable, versioned, signed tool bundles that run inside
 * the gVisor sandbox. This package is a placeholder for Phase 2 work.
 *
 * Phase 2 will implement:
 * - Skill manifest schema (Zod-validated)
 * - Skill registry (local filesystem + remote fetch)
 * - Skill signature verification (Ed25519)
 * - Skill sandbox isolation (per-skill container)
 * - gRPC server on :19005
 */

export const SKILLS_ENGINE_VERSION = "0.1.0";
export const SKILLS_ENGINE_PHASE = 2;

// Stub: Phase 2 not yet implemented
export class SkillsEngineStub {
  isReady(): boolean {
    return false;
  }

  getStatus(): string {
    return "Phase 2 stub — not implemented";
  }
}
