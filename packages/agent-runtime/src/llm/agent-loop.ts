/**
 * agent-loop.ts — Core agentic LLM ↔ tool execution loop.
 *
 * SECURITY:
 * - All tool calls pass through the policy engine (deny-by-default)
 * - High-risk tools require human approval before execution
 * - Credentials injected by vault (never seen by LLM)
 * - All tool executions sandboxed in gVisor containers
 * - Every tool call and result logged to the audit system
 */
import { PolicyDeniedError, CostCapError } from "@secureclaw/shared";
import type { SanitizerService } from "@secureclaw/input-sanitizer";
import type { GrpcAgentChunk } from "@secureclaw/shared";
import type { SessionContext } from "../session/session-context.js";
import {
  addUserMessage,
  addAssistantMessage,
  addToolResult,
  recordUsage,
} from "../session/session-context.js";
import { buildSecuritySystemPrompt } from "../prompt/system-prompt-builder.js";
import type { ToolPolicyEngine } from "../tools/policy-engine.js";
import type { ApprovalGate } from "../tools/approval-gate.js";
import type { LLMTool } from "./provider.interface.js";
import type { VaultGrpcClient } from "../grpc/clients/vault.client.js";
import type { AuditGrpcClient } from "../grpc/clients/audit.client.js";
import type { SandboxGrpcClient } from "../grpc/clients/sandbox.client.js";

// Tool definitions exposed to the LLM — must match TOOL_REGISTRY
const TOOL_DEFINITIONS: LLMTool[] = [
  {
    id: "shell_exec",
    description: "Execute a shell command in a sandboxed gVisor container. Network access disabled by default.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        timeout_seconds: { type: "number", description: "Maximum execution time in seconds (default 60)" },
      },
      required: ["command"],
    },
  },
  {
    id: "http_request",
    description: "Make an HTTP request from a sandboxed container. Allowed domains must be specified.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to request" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET" },
        headers: { type: "object", description: "HTTP headers to send" },
        body: { type: "string", description: "Request body (for POST/PUT)" },
      },
      required: ["url"],
    },
  },
  {
    id: "file_read",
    description: "Read the contents of a file. Path must be within the allowed workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file to read" },
        encoding: { type: "string", enum: ["utf-8", "base64"], default: "utf-8" },
      },
      required: ["path"],
    },
  },
  {
    id: "file_write",
    description: "Write content to a file. Path must be within the allowed workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to write to" },
        content: { type: "string", description: "Content to write" },
        append: { type: "boolean", description: "Append to existing file (default false)" },
      },
      required: ["path", "content"],
    },
  },
];

// Docker images for each tool (pre-approved images only)
const TOOL_IMAGES: Record<string, string> = {
  shell_exec: "secureclaw/shell-exec:latest",
  http_request: "secureclaw/http-request:latest",
  file_read: "secureclaw/file-read:latest",
  file_write: "secureclaw/file-write:latest",
};

export class AgentLoop {
  constructor(
    private readonly sanitizer: SanitizerService,
    private readonly policyEngine: ToolPolicyEngine,
    private readonly approvalGate: ApprovalGate,
    private readonly vaultClient: VaultGrpcClient,
    private readonly auditClient: AuditGrpcClient,
    private readonly sandboxClient: SandboxGrpcClient
  ) {}

  /**
   * Run one user message through the LLM loop.
   * Yields AgentChunk messages that are forwarded to the gateway.
   */
  async *run(ctx: SessionContext, content: string): AsyncGenerator<GrpcAgentChunk> {
    // Sanitize user input for injection
    const sanitizeResult = this.sanitizer.sanitizeUserInput(content, ctx.session_id);

    if (sanitizeResult.injection_scan.highest_severity === "critical" && sanitizeResult.injection_scan.is_suspicious) {
      this.auditClient.logEvent({
        event_type: "INJECTION_DETECTED",
        session_id: ctx.session_id,
        user_id: ctx.user_id,
        payload: { excerpt: content.slice(0, 200), source: "user_input" },
        severity: "CRITICAL",
      });
      yield {
        injection_warning: {
          excerpt: content.slice(0, 200),
          pattern_matched: sanitizeResult.injection_scan.matches[0]?.pattern_id ?? "unknown",
        },
      };
      return; // Reject the message
    }

    // Check daily cost cap before doing any work
    try {
      const summary = await this.auditClient.getCostSummary(ctx.user_id);
      if (summary.cap_exceeded) {
        this.auditClient.logEvent({
          event_type: "COST_CAP_EXCEEDED",
          session_id: ctx.session_id,
          user_id: ctx.user_id,
          payload: { current_usd: summary.total_cost_usd, cap_usd: summary.cap_usd },
          severity: "WARN",
        });
        yield {
          error: {
            code: "COST_CAP_EXCEEDED",
            message: new CostCapError(summary.total_cost_usd, summary.cap_usd).message,
          },
        };
        return;
      }
    } catch {
      // Audit service unreachable — fail open with a warning (do not block the user)
      process.stderr.write(`[agent-loop] Could not check cost cap for user ${ctx.user_id} — proceeding\n`);
    }

    addUserMessage(ctx, sanitizeResult.safe_content);
    ctx.status = "active";

    this.auditClient.logEvent({
      event_type: "SESSION_START",
      session_id: ctx.session_id,
      user_id: ctx.user_id,
      payload: { content_length: content.length },
      severity: "INFO",
    });

    // LLM loop: may iterate multiple turns if tools are called
    let continueLoop = true;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsExecuted = 0;

    while (continueLoop) {
      const systemPrompt = buildSecuritySystemPrompt({
        agentName: "SecureClaw",
        sessionId: ctx.session_id,
        sessionDelimiter: ctx.delimiters.open_tag,
        allowedToolIds: this.policyEngine.getAllowedToolIds(),
        costCapUsd: 5.0,
      });

      // Only expose tools that the policy engine allows
      const allowedTools = TOOL_DEFINITIONS.filter((t) =>
        this.policyEngine.isAllowed(t.id)
      );

      let accumulatedText = "";
      let hadToolCallsThisTurn = false;

      // Accumulate tool calls and buffer results so we can write to ctx.messages
      // in the correct order: assistant-with-tool-calls THEN tool-results.
      // (Adding tool results inside the for-await would produce the wrong order.)
      const toolCallsThisTurn: Array<{ call_id: string; tool_id: string; input: Record<string, unknown> }> = [];
      const toolResultsBuffer: Array<{ call_id: string; tool_id: string; result: string }> = [];

      for await (const chunk of ctx.provider.streamCompletion(
        ctx.messages,
        allowedTools,
        systemPrompt
      )) {
        if (chunk.type === "text") {
          accumulatedText += chunk.text;
          yield { text: { delta: chunk.text, is_final: false } };
        } else if (chunk.type === "tool_call") {
          hadToolCallsThisTurn = true;
          const { call_id, tool_id, input } = chunk.tool_call;

          // Track the tool call regardless of outcome so the assistant message is correct
          toolCallsThisTurn.push({ call_id, tool_id, input });

          // Policy check — throws PolicyDeniedError if denied
          let decision;
          try {
            decision = this.policyEngine.evaluate(tool_id);
          } catch (err) {
            if (err instanceof PolicyDeniedError) {
              this.auditClient.logEvent({
                event_type: "POLICY_DENIED",
                session_id: ctx.session_id,
                user_id: ctx.user_id,
                payload: { tool_id, reason: err.message },
                severity: "WARN",
              });
              yield {
                error: {
                  code: "POLICY_DENIED",
                  message: `Tool '${tool_id}' is not allowed by policy`,
                },
              };
              toolResultsBuffer.push({ call_id, tool_id, result: "[TOOL DENIED BY POLICY]" });
              continue;
            }
            throw err;
          }

          const inputPreview = JSON.stringify(input).slice(0, 300);

          // Human approval gate (if required)
          if (decision.requires_approval) {
            ctx.status = "awaiting_approval";
            yield {
              tool_pending: {
                call_id,
                tool_id,
                input_preview: inputPreview,
                requires_approval: true,
                approval_timeout_seconds: 300,
              },
            };

            this.auditClient.logEvent({
              event_type: "APPROVAL_REQUESTED",
              session_id: ctx.session_id,
              user_id: ctx.user_id,
              payload: { call_id, tool_id, input_preview: inputPreview },
              severity: "INFO",
            });

            const approved = await this.approvalGate.waitForApproval({
              call_id,
              tool_id,
              session_id: ctx.session_id,
              input_preview: inputPreview,
            });

            ctx.status = "active";

            this.auditClient.logEvent({
              event_type: approved ? "APPROVAL_GRANTED" : "APPROVAL_DENIED",
              session_id: ctx.session_id,
              user_id: ctx.user_id,
              payload: { call_id, tool_id },
              severity: approved ? "INFO" : "WARN",
            });

            if (!approved) {
              toolResultsBuffer.push({ call_id, tool_id, result: "[TOOL EXECUTION DENIED BY USER]" });
              yield {
                error: {
                  code: "APPROVAL_DENIED",
                  message: `Tool '${tool_id}' was denied by the user`,
                },
              };
              continue;
            }
          } else {
            yield {
              tool_pending: {
                call_id,
                tool_id,
                input_preview: inputPreview,
                requires_approval: false,
                approval_timeout_seconds: 0,
              },
            };
          }

          // Execute the tool via sandbox
          const image = TOOL_IMAGES[tool_id] ?? `secureclaw/${tool_id}:latest`;
          let toolInputJson = JSON.stringify(input);

          // Inject credentials — vault replaces __VAULT_REF:id__ placeholders
          try {
            toolInputJson = await this.vaultClient.injectCredential("", toolInputJson, "");
          } catch {
            // No credentials to inject — use input as-is
          }

          this.auditClient.logEvent({
            event_type: "TOOL_CALL",
            session_id: ctx.session_id,
            user_id: ctx.user_id,
            payload: { call_id, tool_id, image, input_preview: inputPreview },
            severity: "INFO",
          });

          const startMs = Date.now();
          let toolResult: string;
          let toolSuccess = false;

          try {
            const result = await this.sandboxClient.runTool({
              call_id,
              tool_id,
              image,
              input_json: toolInputJson,
              timeout_seconds: decision.resource_limits.timeout_seconds,
              memory_bytes: decision.resource_limits.memory_bytes,
              cpu_shares: decision.resource_limits.cpu_shares,
              pids_limit: decision.resource_limits.pids_limit,
              network_mode: "none",
            });

            const durationMs = Date.now() - startMs;
            toolSuccess = result.exit_code === 0 && !result.timed_out;
            toolResult = result.timed_out
              ? `[TIMEOUT after ${durationMs}ms]`
              : result.stdout || result.stderr || `[Exit code: ${result.exit_code}]`;

            this.auditClient.logEvent({
              event_type: "TOOL_RESULT",
              session_id: ctx.session_id,
              user_id: ctx.user_id,
              payload: {
                call_id,
                tool_id,
                exit_code: result.exit_code,
                duration_ms: durationMs,
                timed_out: result.timed_out,
                oom_killed: result.oom_killed,
                success: toolSuccess,
              },
              severity: toolSuccess ? "INFO" : "WARN",
            });

            yield {
              tool_result: {
                call_id,
                tool_id,
                success: toolSuccess,
                duration_ms: durationMs,
                error_message: toolSuccess ? "" : result.stderr,
              },
            };
          } catch (err) {
            const durationMs = Date.now() - startMs;
            toolResult = `[SANDBOX ERROR: ${err instanceof Error ? err.message : String(err)}]`;

            this.auditClient.logEvent({
              event_type: "TOOL_RESULT",
              session_id: ctx.session_id,
              user_id: ctx.user_id,
              payload: { call_id, tool_id, error: toolResult, duration_ms: durationMs },
              severity: "ERROR",
            });

            yield {
              tool_result: {
                call_id,
                tool_id,
                success: false,
                duration_ms: durationMs,
                error_message: toolResult,
              },
            };
          }

          toolResultsBuffer.push({ call_id, tool_id, result: toolResult });
          toolCallsExecuted++;
        } else if (chunk.type === "finish") {
          totalInputTokens += chunk.usage.input_tokens;
          totalOutputTokens += chunk.usage.output_tokens;

          if (chunk.finish_reason !== "tool_use") {
            continueLoop = false;
          }
        } else if (chunk.type === "error") {
          yield { error: { code: "LLM_ERROR", message: chunk.error } };
          continueLoop = false;
        }
      }

      // Write to conversation history in the correct order:
      //   1. Assistant message (with tool_calls if any) — must come first
      //   2. Tool results — each provider maps role:"tool" to its native format
      if (accumulatedText || toolCallsThisTurn.length > 0) {
        addAssistantMessage(
          ctx,
          accumulatedText,
          toolCallsThisTurn.length > 0 ? toolCallsThisTurn : undefined
        );
      }
      for (const tr of toolResultsBuffer) {
        addToolResult(ctx, tr.call_id, tr.tool_id, tr.result);
      }

      // If no tool calls were made this turn, we're done
      if (!hadToolCallsThisTurn) {
        continueLoop = false;
      }
    }

    // Record final usage
    const costUsd = ctx.provider.estimateCostUsd(totalInputTokens, totalOutputTokens);
    recordUsage(ctx, totalInputTokens, totalOutputTokens, costUsd);

    // Persist cost to the ledger (fire-and-forget — must not crash the agent)
    this.auditClient.recordCost({
      session_id: ctx.session_id,
      user_id: ctx.user_id,
      provider: ctx.provider.provider_name,
      model: ctx.provider.model_name,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cost_usd: costUsd,
    });

    this.auditClient.logEvent({
      event_type: "SESSION_END",
      session_id: ctx.session_id,
      user_id: ctx.user_id,
      payload: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cost_usd: costUsd,
        tool_calls_executed: toolCallsExecuted,
      },
      severity: "INFO",
    });

    ctx.status = "idle";

    yield {
      complete: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cost_usd: costUsd,
        tool_calls_executed: toolCallsExecuted,
      },
    };
  }
}
