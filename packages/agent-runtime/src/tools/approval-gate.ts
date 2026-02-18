/**
 * approval-gate.ts — Human-in-the-loop approval gate.
 *
 * When a tool requires human approval, the agent loop pauses at this gate.
 * The gateway streams a ToolCallPending event to the client.
 * The client sends an approve/deny response back to the gateway.
 * The gateway calls ApproveToolCall on the agent-runtime gRPC service.
 * The gate resumes with the decision.
 *
 * SECURITY:
 * - Timeout = implicit denial (default 5 minutes)
 * - No way to bypass the gate from within the agent loop
 * - All approval decisions are logged to the audit system
 */

export interface PendingApproval {
  call_id: string;
  tool_id: string;
  session_id: string;
  input_preview: string;
  requested_at: number;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ApprovalGate {
  private pending: Map<string, PendingApproval> = new Map();

  /**
   * Register a tool call as pending approval.
   * Returns a Promise that resolves when the user approves or denies.
   * Times out automatically after the configured duration.
   */
  waitForApproval(params: {
    call_id: string;
    tool_id: string;
    session_id: string;
    input_preview: string;
    timeout_ms?: number;
  }): Promise<boolean> {
    const timeoutMs = params.timeout_ms ?? DEFAULT_APPROVAL_TIMEOUT_MS;

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(params.call_id);
        // Timeout = implicit denial (fail closed)
        process.stderr.write(
          `[approval-gate] Approval timeout for call ${params.call_id} (tool: ${params.tool_id})\n`
        );
        resolve(false);
      }, timeoutMs);

      this.pending.set(params.call_id, {
        call_id: params.call_id,
        tool_id: params.tool_id,
        session_id: params.session_id,
        input_preview: params.input_preview,
        requested_at: Date.now(),
        resolve,
        timeout,
      });
    });
  }

  /**
   * Respond to a pending approval request.
   * Called by the gRPC ApproveToolCall handler.
   */
  respond(callId: string, approved: boolean): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false; // Not found (already resolved or never existed)

    clearTimeout(pending.timeout);
    this.pending.delete(callId);
    pending.resolve(approved);
    return true;
  }

  /**
   * Get all pending approvals for a session (for status reporting).
   */
  getPendingForSession(sessionId: string): PendingApproval[] {
    return Array.from(this.pending.values()).filter(
      (p) => p.session_id === sessionId
    );
  }

  /**
   * Cancel all pending approvals for a session (called on session termination).
   */
  cancelSession(sessionId: string): void {
    for (const [callId, pending] of this.pending) {
      if (pending.session_id === sessionId) {
        clearTimeout(pending.timeout);
        this.pending.delete(callId);
        pending.resolve(false); // Cancel = deny
      }
    }
  }
}
