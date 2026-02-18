import { z } from "zod";

export const AuditEventTypeSchema = z.enum([
  "TOOL_CALL",
  "TOOL_RESULT",
  "SESSION_START",
  "SESSION_END",
  "INJECTION_DETECTED",
  "POLICY_DENIED",
  "AUTH_FAILED",
  "COST_CAP_EXCEEDED",
  "COST_CAP_WARNING",
  "APPROVAL_REQUESTED",
  "APPROVAL_GRANTED",
  "APPROVAL_DENIED",
  "APPROVAL_TIMEOUT",
  "PLAINTEXT_SECRET_DETECTED",
  "SANDBOX_ERROR",
]);

export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditSeveritySchema = z.enum(["INFO", "WARN", "ERROR", "CRITICAL"]);
export type AuditSeverity = z.infer<typeof AuditSeveritySchema>;

export const AuditEventSchema = z.object({
  id: z.number().int().optional(), // Auto-assigned by DB
  event_type: AuditEventTypeSchema,
  session_id: z.string().optional(),
  user_id: z.string().optional(),
  payload: z.record(z.unknown()),
  severity: AuditSeveritySchema,
  created_at_unix_ms: z.number().int(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AlertSchema = z.object({
  id: z.number().int().optional(),
  rule_id: z.string(),
  severity: AuditSeveritySchema,
  session_id: z.string().optional(),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
  created_at_unix_ms: z.number().int(),
  acknowledged: z.boolean().default(false),
});

export type Alert = z.infer<typeof AlertSchema>;
