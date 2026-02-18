/**
 * session-manager.ts — Session lifecycle management.
 *
 * SECURITY: Sessions are strictly isolated.
 * No shared mutable state between sessions.
 * Sessions are destroyed completely when terminated.
 */
import { randomUuid } from "@secureclaw/shared";
import { SanitizerService } from "@secureclaw/input-sanitizer";
import { createSessionContext, type SessionContext } from "./session-context.js";
import { ApprovalGate } from "../tools/approval-gate.js";
import type { LLMProvider } from "../llm/provider.interface.js";

export class SessionManager {
  // Map from session_id → SessionContext (in-memory, never persisted)
  private sessions: Map<string, SessionContext> = new Map();
  private sanitizer: SanitizerService;
  readonly approvalGate: ApprovalGate;

  constructor(sanitizer: SanitizerService) {
    this.sanitizer = sanitizer;
    this.approvalGate = new ApprovalGate();
  }

  createSession(params: {
    user_id: string;
    provider: LLMProvider;
  }): SessionContext {
    const session_id = randomUuid();

    // Initialize per-session delimiters (unique, cryptographically random)
    const delimiters = this.sanitizer.initSession(session_id);

    const ctx = createSessionContext({
      session_id,
      user_id: params.user_id,
      provider: params.provider,
      delimiters,
    });

    this.sessions.set(session_id, ctx);
    return ctx;
  }

  getSession(sessionId: string): SessionContext | null {
    return this.sessions.get(sessionId) ?? null;
  }

  terminateSession(sessionId: string): SessionContext | null {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return null;

    // Cancel any pending approvals
    this.approvalGate.cancelSession(sessionId);

    // Clean up sanitizer state for this session
    this.sanitizer.destroySession(sessionId);

    // Remove from active sessions
    this.sessions.delete(sessionId);

    ctx.status = "terminated";
    return ctx;
  }

  getActiveSessions(): SessionContext[] {
    return Array.from(this.sessions.values());
  }

  /** Terminate all sessions (called on shutdown) */
  terminateAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.terminateSession(sessionId);
    }
  }
}
