/**
 * policy-engine.ts — Deny-by-default tool policy engine.
 *
 * SECURITY: Every tool call passes through this engine before execution.
 * If a tool is not explicitly in the allowlist, it is DENIED.
 * There is no wildcard allowlist, no "allow all" mode.
 *
 * Denials are logged to the audit system for visibility.
 */
import type { ToolPolicyEntry, SecurityConfig } from "@tessera/shared";
import { PolicyDeniedError } from "@tessera/shared";

export interface PolicyDecisionResult {
  allowed: boolean;
  requires_approval: boolean;
  sandbox_required: boolean;
  resource_limits: {
    memory_bytes: number;
    cpu_shares: number;
    pids_limit: number;
    timeout_seconds: number;
  };
  reason?: string | undefined;
}

export class ToolPolicyEngine {
  private allowlist: Map<string, ToolPolicyEntry>;
  private humanApprovalTools: Set<string>;

  constructor(config: Pick<SecurityConfig, "human_approval_required_for">, toolAllowlist: ToolPolicyEntry[]) {
    this.allowlist = new Map(toolAllowlist.map((p) => [p.tool_id, p]));
    this.humanApprovalTools = new Set(config.human_approval_required_for);
  }

  /**
   * Evaluate whether a tool call is allowed.
   * Throws PolicyDeniedError if not allowed.
   * Returns decision details if allowed.
   */
  evaluate(toolId: string): PolicyDecisionResult {
    const policy = this.allowlist.get(toolId);

    if (!policy || !policy.allowed) {
      throw new PolicyDeniedError(
        toolId,
        "Tool is not in the allowlist. Deny-by-default policy."
      );
    }

    // Check if global config requires human approval for this tool type
    const requiresApproval =
      policy.requires_approval || this.humanApprovalTools.has(toolId);

    return {
      allowed: true,
      requires_approval: requiresApproval,
      sandbox_required: policy.sandbox_required,
      resource_limits: {
        memory_bytes: policy.memory_bytes,
        cpu_shares: 0.5, // Default: half a CPU
        pids_limit: policy.pids_limit,
        timeout_seconds: policy.timeout_seconds,
      },
    };
  }

  /**
   * Check if a tool is in the allowlist (without throwing).
   */
  isAllowed(toolId: string): boolean {
    const policy = this.allowlist.get(toolId);
    return policy?.allowed === true;
  }

  /**
   * Get all allowed tool IDs for display in the system prompt.
   */
  getAllowedToolIds(): string[] {
    return Array.from(this.allowlist.entries())
      .filter(([, p]) => p.allowed)
      .map(([id]) => id);
  }
}
