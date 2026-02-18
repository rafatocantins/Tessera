import { z } from "zod";

// Tool call from LLM to executor
export const ToolCallSchema = z.object({
  call_id: z.string(),
  session_id: z.string().uuid(),
  tool_id: z.string(),
  input: z.record(z.unknown()),
  // credential_refs: vault ref IDs that need injection before execution
  // The LLM may produce __VAULT_REF:ref_id__ placeholders; these are listed here
  credential_refs: z.array(z.string()).default([]),
  timestamp_utc: z.string().datetime(),
  requires_approval: z.boolean().default(false),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// Result after tool execution
export const ToolResultSchema = z.object({
  call_id: z.string(),
  tool_id: z.string(),
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  duration_ms: z.number().int(),
  sandbox_container_id: z.string().optional(),
  timed_out: z.boolean().default(false),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

// Policy decision for a tool call
export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  requires_approval: z.boolean().default(false),
  sandbox_required: z.boolean().default(true),
  resource_limits: z
    .object({
      memory_bytes: z.number().int(),
      cpu_shares: z.number(),
      pids_limit: z.number().int(),
      timeout_seconds: z.number().int(),
    })
    .optional(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// Approval request (sent to user via gateway when a tool needs approval)
export const ApprovalRequestSchema = z.object({
  call_id: z.string(),
  session_id: z.string().uuid(),
  tool_id: z.string(),
  input_preview: z.string().describe("Human-readable summary — no raw credentials"),
  requested_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
