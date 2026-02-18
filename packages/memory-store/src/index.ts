/**
 * memory-store — Phase 2 stub.
 *
 * Persistent, scoped memory for the agent runtime.
 * Phase 2 will add vector embeddings and semantic search.
 */

export { MEMORY_SCHEMA_SQL } from "./schema.js";

export const MEMORY_STORE_VERSION = "0.1.0";
export const MEMORY_STORE_PHASE = 2;

// Stub: Phase 2 not yet implemented
export class MemoryStoreStub {
  isReady(): boolean {
    return false;
  }

  getStatus(): string {
    return "Phase 2 stub — not implemented";
  }
}
