/**
 * output-guardrail.ts — Validates agent output before executing destructive tools.
 *
 * Before any tool call that modifies external state (send_message, file_write,
 * network_request, etc.), the agent output is validated against these guardrails.
 * Failed guardrails block execution and require user confirmation.
 */
import { detectAndRedactPii } from "../heuristic/pii.detector.js";

export interface GuardrailCheck {
  id: string;
  description: string;
}

export interface GuardrailResult {
  passed: boolean;
  violations: GuardrailViolation[];
  redacted_output?: string | undefined; // Set if PII was found and redacted
}

export interface GuardrailViolation {
  check_id: string;
  message: string;
  severity: "warn" | "block";
}

// Tool IDs that require guardrail checks before execution
export const DESTRUCTIVE_TOOL_IDS = new Set([
  "send_message",
  "send_email",
  "file_write",
  "file_delete",
  "shell_exec",
  "network_post",
  "network_put",
  "network_delete",
  "browser_form_fill",
  "browser_click_submit",
]);

/**
 * Validate agent-generated tool input before executing a destructive tool.
 * Returns a result indicating whether execution should proceed.
 */
export function checkOutputGuardrails(
  toolId: string,
  toolInputJson: string
): GuardrailResult {
  if (!DESTRUCTIVE_TOOL_IDS.has(toolId)) {
    return { passed: true, violations: [] };
  }

  const violations: GuardrailViolation[] = [];
  let redacted_output: string | undefined;

  // Check 1: PII detection in outbound data
  const piiResult = detectAndRedactPii(toolInputJson);
  if (piiResult.has_pii) {
    violations.push({
      check_id: "PII_IN_OUTPUT",
      message: `PII detected in tool input (${piiResult.types_found.join(", ")}). Review before sending.`,
      severity: "warn",
    });
    redacted_output = piiResult.redacted_content;
  }

  // Check 2: Vault refs must be resolved before execution
  if (toolInputJson.includes("__VAULT_REF:")) {
    violations.push({
      check_id: "UNRESOLVED_VAULT_REF",
      message: "Tool input contains unresolved vault reference. Credentials must be injected before execution.",
      severity: "block",
    });
  }

  // Check 3: Suspicious URLs in outbound network calls
  if (toolId.startsWith("network_") || toolId === "send_email" || toolId === "send_message") {
    const suspiciousUrlPatterns = [
      /webhook\.site/i,
      /requestbin/i,
      /pipedream\.net/i,
      /ngrok\.io/i,
    ];
    for (const pattern of suspiciousUrlPatterns) {
      if (pattern.test(toolInputJson)) {
        violations.push({
          check_id: "SUSPICIOUS_URL",
          message: "Tool input contains a URL associated with data exfiltration services.",
          severity: "warn",
        });
        break;
      }
    }
  }

  const hasBlockingViolation = violations.some((v) => v.severity === "block");

  const result: GuardrailResult = {
    passed: !hasBlockingViolation,
    violations,
  };
  if (redacted_output !== undefined) {
    result.redacted_output = redacted_output;
  }
  return result;
}
