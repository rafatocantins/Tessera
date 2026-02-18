import { describe, it, expect } from "vitest";
import {
  SecureClawError,
  AuthenticationError,
  AuthorizationError,
  PolicyDeniedError,
  CostCapError,
  InjectionDetectedError,
  SandboxError,
  CredentialError,
  SessionError,
  ValidationError,
} from "./index.js";

describe("SecureClawError", () => {
  it("is an instance of Error", () => {
    const err = new SecureClawError("test", "TEST_CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SecureClawError);
  });

  it("stores message, code, and context", () => {
    const ctx = { detail: "extra info" };
    const err = new SecureClawError("something went wrong", "MY_CODE", ctx);
    expect(err.message).toBe("something went wrong");
    expect(err.code).toBe("MY_CODE");
    expect(err.context).toEqual(ctx);
  });

  it("has name 'SecureClawError'", () => {
    expect(new SecureClawError("m", "C").name).toBe("SecureClawError");
  });

  it("defaults context to empty object", () => {
    const err = new SecureClawError("msg", "CODE");
    expect(err.context).toEqual({});
  });

  it("has a stack trace", () => {
    const err = new SecureClawError("msg", "CODE");
    expect(err.stack).toBeDefined();
    expect(err.stack!.length).toBeGreaterThan(0);
  });
});

describe("AuthenticationError", () => {
  it("extends SecureClawError", () => {
    const err = new AuthenticationError("bad token");
    expect(err).toBeInstanceOf(SecureClawError);
  });

  it("has code AUTH_FAILED", () => {
    expect(new AuthenticationError("x").code).toBe("AUTH_FAILED");
  });

  it("has name AuthenticationError", () => {
    expect(new AuthenticationError("x").name).toBe("AuthenticationError");
  });
});

describe("AuthorizationError", () => {
  it("has code AUTHORIZATION_FAILED", () => {
    expect(new AuthorizationError("x").code).toBe("AUTHORIZATION_FAILED");
  });

  it("has name AuthorizationError", () => {
    expect(new AuthorizationError("x").name).toBe("AuthorizationError");
  });
});

describe("PolicyDeniedError", () => {
  it("includes the tool_id in the message", () => {
    const err = new PolicyDeniedError("shell_exec", "not in allowlist");
    expect(err.message).toContain("shell_exec");
    expect(err.message).toContain("not in allowlist");
  });

  it("exposes tool_id as a property", () => {
    const err = new PolicyDeniedError("file_write", "requires approval");
    expect(err.tool_id).toBe("file_write");
  });

  it("has code POLICY_DENIED", () => {
    expect(new PolicyDeniedError("t", "r").code).toBe("POLICY_DENIED");
  });

  it("stores tool_id and reason in context", () => {
    const err = new PolicyDeniedError("http_request", "disallowed target");
    expect(err.context["tool_id"]).toBe("http_request");
    expect(err.context["reason"]).toBe("disallowed target");
  });
});

describe("CostCapError", () => {
  it("formats amounts in the message", () => {
    const err = new CostCapError(5.1234, 5.0);
    expect(err.message).toContain("5.1234");
    expect(err.message).toContain("5.00");
  });

  it("has code COST_CAP_EXCEEDED", () => {
    expect(new CostCapError(1, 1).code).toBe("COST_CAP_EXCEEDED");
  });

  it("stores current and cap in context", () => {
    const err = new CostCapError(6.0, 5.0);
    expect(err.context["current_usd"]).toBe(6.0);
    expect(err.context["cap_usd"]).toBe(5.0);
  });
});

describe("InjectionDetectedError", () => {
  it("includes pattern name in message", () => {
    const err = new InjectionDetectedError("IGNORE_INSTRUCTIONS", "ignore all previous...");
    expect(err.message).toContain("IGNORE_INSTRUCTIONS");
  });

  it("has code INJECTION_DETECTED", () => {
    expect(new InjectionDetectedError("p", "e").code).toBe("INJECTION_DETECTED");
  });

  it("truncates excerpt to 200 chars", () => {
    const longExcerpt = "x".repeat(500);
    const err = new InjectionDetectedError("P", longExcerpt);
    expect((err.context["excerpt"] as string).length).toBeLessThanOrEqual(200);
  });
});

describe("SandboxError", () => {
  it("has code SANDBOX_ERROR", () => {
    expect(new SandboxError("container failed").code).toBe("SANDBOX_ERROR");
  });

  it("accepts optional context", () => {
    const err = new SandboxError("timeout", { container_id: "abc123" });
    expect(err.context["container_id"]).toBe("abc123");
  });
});

describe("CredentialError", () => {
  it("has code CREDENTIAL_ERROR", () => {
    expect(new CredentialError("not found").code).toBe("CREDENTIAL_ERROR");
  });
});

describe("SessionError", () => {
  it("has code SESSION_ERROR", () => {
    expect(new SessionError("not found").code).toBe("SESSION_ERROR");
  });
});

describe("ValidationError", () => {
  it("has code VALIDATION_ERROR", () => {
    const err = new ValidationError("bad input", ["field required"]);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("stores issues in context", () => {
    const issues = [{ path: "email", message: "invalid" }];
    const err = new ValidationError("invalid", issues);
    expect(err.context["issues"]).toEqual(issues);
  });
});
