/**
 * alert-rules.ts — Alert rule definitions.
 *
 * Rules are evaluated after every audit event is persisted.
 * A rule returns an AlertFinding if it triggers, null otherwise.
 */
import type { AuditEvent, AuditSeverity } from "@tessera/shared";

export interface AlertContext {
  toolCallsLastMinute: number;
  authFailuresLastFiveMin: number;
  dailyCostUsd: number;
  costCapUsd: number;
  largestOutputBytesThisSession: number;
}

export interface AlertFinding {
  rule_id: string;
  message: string;
  severity: AuditSeverity;
  context: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  description: string;
  severity: AuditSeverity; // Severity of alert if rule triggers
  evaluate(event: AuditEvent, ctx: AlertContext): AlertFinding | null;
}

// Alert severity uses WARN instead of LOW/MEDIUM/HIGH for consistency with AuditSeverity

export const ALERT_RULES: AlertRule[] = [
  {
    id: "INJECTION_DETECTED",
    description: "Prompt injection pattern detected in input",
    severity: "CRITICAL",
    evaluate(event): AlertFinding | null {
      if (event.event_type !== "INJECTION_DETECTED") return null;
      return {
        rule_id: this.id,
        message: "Prompt injection attempt detected and blocked",
        severity: this.severity,
        context: { payload: event.payload },
      };
    },
  },

  {
    id: "PLAINTEXT_SECRET_FOUND",
    description: "Plaintext credential found on disk",
    severity: "CRITICAL",
    evaluate(event): AlertFinding | null {
      if (event.event_type !== "PLAINTEXT_SECRET_DETECTED") return null;
      return {
        rule_id: this.id,
        message: "Plaintext secret detected — credential exposure risk",
        severity: this.severity,
        context: { payload: event.payload },
      };
    },
  },

  {
    id: "RAPID_TOOL_CALLS",
    description: "More than 20 tool calls in 60 seconds from one session",
    severity: "ERROR",
    evaluate(event, ctx): AlertFinding | null {
      if (event.event_type !== "TOOL_CALL") return null;
      if (ctx.toolCallsLastMinute <= 20) return null;
      return {
        rule_id: this.id,
        message: `Unusually rapid tool calls: ${ctx.toolCallsLastMinute} in last 60s`,
        severity: this.severity,
        context: { count: ctx.toolCallsLastMinute, session_id: event.session_id },
      };
    },
  },

  {
    id: "COST_CAP_WARNING",
    description: "Daily cost has exceeded 80% of configured cap",
    severity: "WARN",
    evaluate(_event, ctx): AlertFinding | null {
      if (ctx.costCapUsd <= 0) return null;
      const pct = ctx.dailyCostUsd / ctx.costCapUsd;
      if (pct < 0.8) return null;
      return {
        rule_id: this.id,
        message: `Daily cost at ${(pct * 100).toFixed(0)}% of cap ($${ctx.dailyCostUsd.toFixed(4)} / $${ctx.costCapUsd.toFixed(2)})`,
        severity: this.severity,
        context: { current_usd: ctx.dailyCostUsd, cap_usd: ctx.costCapUsd, percent: pct },
      };
    },
  },

  {
    id: "COST_CAP_EXCEEDED",
    description: "Daily cost cap exceeded",
    severity: "ERROR",
    evaluate(event): AlertFinding | null {
      if (event.event_type !== "COST_CAP_EXCEEDED") return null;
      return {
        rule_id: this.id,
        message: "Daily API cost cap exceeded — agent will refuse further LLM calls",
        severity: this.severity,
        context: { payload: event.payload },
      };
    },
  },

  {
    id: "REPEATED_AUTH_FAILURE",
    description: "More than 5 authentication failures in 5 minutes",
    severity: "CRITICAL",
    evaluate(event, ctx): AlertFinding | null {
      if (event.event_type !== "AUTH_FAILED") return null;
      if (ctx.authFailuresLastFiveMin <= 5) return null;
      return {
        rule_id: this.id,
        message: `Possible brute force: ${ctx.authFailuresLastFiveMin} auth failures in 5 minutes`,
        severity: this.severity,
        context: { count: ctx.authFailuresLastFiveMin },
      };
    },
  },

  {
    id: "SANDBOX_ERROR",
    description: "Sandbox execution failure",
    severity: "ERROR",
    evaluate(event): AlertFinding | null {
      if (event.event_type !== "SANDBOX_ERROR") return null;
      return {
        rule_id: this.id,
        message: "Sandbox container execution failed",
        severity: this.severity,
        context: { payload: event.payload },
      };
    },
  },
];
