export { SecureClawError } from "./base.error.js";

import { SecureClawError } from "./base.error.js";

export class AuthenticationError extends SecureClawError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "AUTH_FAILED", context);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends SecureClawError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "AUTHORIZATION_FAILED", context);
    this.name = "AuthorizationError";
  }
}

export class PolicyDeniedError extends SecureClawError {
  readonly tool_id: string;
  constructor(toolId: string, reason: string) {
    super(`Tool '${toolId}' denied by policy: ${reason}`, "POLICY_DENIED", { tool_id: toolId, reason });
    this.name = "PolicyDeniedError";
    this.tool_id = toolId;
  }
}

export class CostCapError extends SecureClawError {
  constructor(currentUsd: number, capUsd: number) {
    super(
      `Daily cost cap exceeded: $${currentUsd.toFixed(4)} / $${capUsd.toFixed(2)}`,
      "COST_CAP_EXCEEDED",
      { current_usd: currentUsd, cap_usd: capUsd }
    );
    this.name = "CostCapError";
  }
}

export class InjectionDetectedError extends SecureClawError {
  constructor(pattern: string, excerpt: string) {
    super(
      `Prompt injection detected: pattern '${pattern}'`,
      "INJECTION_DETECTED",
      { pattern, excerpt: excerpt.slice(0, 200) }
    );
    this.name = "InjectionDetectedError";
  }
}

export class SandboxError extends SecureClawError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SANDBOX_ERROR", context);
    this.name = "SandboxError";
  }
}

export class CredentialError extends SecureClawError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CREDENTIAL_ERROR", context);
    this.name = "CredentialError";
  }
}

export class SessionError extends SecureClawError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SESSION_ERROR", context);
    this.name = "SessionError";
  }
}

export class ValidationError extends SecureClawError {
  constructor(message: string, issues: unknown[]) {
    super(message, "VALIDATION_ERROR", { issues });
    this.name = "ValidationError";
  }
}
