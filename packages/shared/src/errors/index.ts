export { TesseraError } from "./base.error.js";

import { TesseraError } from "./base.error.js";

export class AuthenticationError extends TesseraError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "AUTH_FAILED", context);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends TesseraError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "AUTHORIZATION_FAILED", context);
    this.name = "AuthorizationError";
  }
}

export class PolicyDeniedError extends TesseraError {
  readonly tool_id: string;
  constructor(toolId: string, reason: string) {
    super(`Tool '${toolId}' denied by policy: ${reason}`, "POLICY_DENIED", { tool_id: toolId, reason });
    this.name = "PolicyDeniedError";
    this.tool_id = toolId;
  }
}

export class CostCapError extends TesseraError {
  constructor(currentUsd: number, capUsd: number) {
    super(
      `Daily cost cap exceeded: $${currentUsd.toFixed(4)} / $${capUsd.toFixed(2)}`,
      "COST_CAP_EXCEEDED",
      { current_usd: currentUsd, cap_usd: capUsd }
    );
    this.name = "CostCapError";
  }
}

export class InjectionDetectedError extends TesseraError {
  constructor(pattern: string, excerpt: string) {
    super(
      `Prompt injection detected: pattern '${pattern}'`,
      "INJECTION_DETECTED",
      { pattern, excerpt: excerpt.slice(0, 200) }
    );
    this.name = "InjectionDetectedError";
  }
}

export class SandboxError extends TesseraError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SANDBOX_ERROR", context);
    this.name = "SandboxError";
  }
}

export class CredentialError extends TesseraError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CREDENTIAL_ERROR", context);
    this.name = "CredentialError";
  }
}

export class SessionError extends TesseraError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SESSION_ERROR", context);
    this.name = "SessionError";
  }
}

export class ValidationError extends TesseraError {
  constructor(message: string, issues: unknown[]) {
    super(message, "VALIDATION_ERROR", { issues });
    this.name = "ValidationError";
  }
}
