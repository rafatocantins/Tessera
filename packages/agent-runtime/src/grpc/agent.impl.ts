/**
 * agent.impl.ts — AgentService gRPC handler implementations.
 *
 * Implements: CreateSession, SendMessage (streaming), ApproveToolCall,
 * TerminateSession, GetSessionStatus
 */
import type * as grpc from "@grpc/grpc-js";
import type { SessionManager } from "../session/session-manager.js";
import type { AgentLoop } from "../llm/agent-loop.js";
import { createProvider } from "../llm/provider-factory.js";
import type {
  GrpcCreateSessionRequest,
  GrpcCreateSessionResponse,
  GrpcSendMessageRequest,
  GrpcAgentChunk,
  GrpcApproveToolCallRequest,
  GrpcApproveToolCallResponse,
  GrpcTerminateSessionRequest,
  GrpcTerminateSessionResponse,
  GrpcGetSessionStatusRequest,
  GrpcGetSessionStatusResponse,
} from "@secureclaw/shared";

type UnaryCall<Req, Res> = grpc.ServerUnaryCall<Req, Res>;
type StreamCall<Req, Res> = grpc.ServerWritableStream<Req, Res>;
type Callback<Res> = grpc.sendUnaryData<Res>;

export function makeAgentImpl(sessionManager: SessionManager, agentLoop: AgentLoop) {
  return {
    CreateSession(
      call: UnaryCall<GrpcCreateSessionRequest, GrpcCreateSessionResponse>,
      callback: Callback<GrpcCreateSessionResponse>
    ): void {
      try {
        const req = call.request;

        // Create the LLM provider from the request
        let provider;
        try {
          const providerName = req.provider as "anthropic" | "openai" | "gemini" | "ollama";
          const apiKey = process.env[`${req.provider.toUpperCase()}_API_KEY`];
          const model = process.env[`${req.provider.toUpperCase()}_MODEL`];

          if (providerName === "ollama") {
            provider = createProvider({
              provider: "ollama",
              model: model ?? "llama3.2",
              base_url: process.env["OLLAMA_BASE_URL"] ?? "http://127.0.0.1:11434",
              max_tokens: 4096,
            });
          } else if (providerName === "anthropic") {
            provider = createProvider({ provider: "anthropic", model: model ?? "claude-opus-4-6", credential_ref: "", max_tokens: 4096 }, apiKey);
          } else if (providerName === "openai") {
            provider = createProvider({ provider: "openai", model: model ?? "gpt-4o", credential_ref: "", max_tokens: 4096 }, apiKey);
          } else {
            provider = createProvider({ provider: "gemini", model: model ?? "gemini-2.0-flash", credential_ref: "", max_tokens: 4096 }, apiKey);
          }
        } catch (err) {
          callback(null, {
            session_id: "",
            success: false,
            error_message: `Failed to create provider '${req.provider}': ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        const ctx = sessionManager.createSession({
          user_id: req.user_id || "anonymous",
          provider,
        });

        callback(null, { session_id: ctx.session_id, success: true, error_message: "" });
      } catch (err) {
        callback(null, {
          session_id: "",
          success: false,
          error_message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    SendMessage(call: StreamCall<GrpcSendMessageRequest, GrpcAgentChunk>): void {
      const req = call.request;
      const ctx = sessionManager.getSession(req.session_id);

      if (!ctx) {
        call.write({
          error: { code: "SESSION_NOT_FOUND", message: `Session '${req.session_id}' not found` },
        });
        call.end();
        return;
      }

      // Run the agent loop asynchronously, streaming chunks back
      void (async () => {
        try {
          for await (const chunk of agentLoop.run(ctx, req.content)) {
            call.write(chunk);
          }
        } catch (err) {
          call.write({
            error: {
              code: "AGENT_ERROR",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        } finally {
          call.end();
        }
      })();
    },

    ApproveToolCall(
      call: UnaryCall<GrpcApproveToolCallRequest, GrpcApproveToolCallResponse>,
      callback: Callback<GrpcApproveToolCallResponse>
    ): void {
      const req = call.request;
      const responded = sessionManager.approvalGate.respond(req.call_id, req.approved);
      callback(null, {
        success: responded,
        error_message: responded ? "" : `Approval request '${req.call_id}' not found or already resolved`,
      });
    },

    TerminateSession(
      call: UnaryCall<GrpcTerminateSessionRequest, GrpcTerminateSessionResponse>,
      callback: Callback<GrpcTerminateSessionResponse>
    ): void {
      const ctx = sessionManager.terminateSession(call.request.session_id);
      callback(null, {
        success: ctx !== null,
        total_cost_usd: ctx?.total_cost_usd ?? 0,
      });
    },

    GetSessionStatus(
      call: UnaryCall<GrpcGetSessionStatusRequest, GrpcGetSessionStatusResponse>,
      callback: Callback<GrpcGetSessionStatusResponse>
    ): void {
      const ctx = sessionManager.getSession(call.request.session_id);
      if (!ctx) {
        callback(null, {
          session_id: call.request.session_id,
          status: "not_found",
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_cost_usd: 0,
          tool_call_count: 0,
        });
        return;
      }
      callback(null, {
        session_id: ctx.session_id,
        status: ctx.status,
        total_input_tokens: ctx.total_input_tokens,
        total_output_tokens: ctx.total_output_tokens,
        total_cost_usd: ctx.total_cost_usd,
        tool_call_count: ctx.tool_call_count,
      });
    },
  };
}
