/**
 * memory.client.ts — gRPC client for the MemoryService.
 *
 * Write operations (storeSession, appendMessage, finalizeSession) are fire-and-forget —
 * memory failures must NOT crash the agent runtime.
 *
 * getRecentMessages is on the critical path for session start (first turn only)
 * and has a 2-second timeout. It always resolves — never rejects.
 */
import { loadProto, grpc, clientCredentials } from "@secureclaw/shared";
import type {
  GrpcStoreSessionRequest,
  GrpcAppendMessageRequest,
  GrpcFinalizeSessionRequest,
  GrpcGetRecentMessagesRequest,
  GrpcGetRecentMessagesResponse,
  GrpcStoredMessage,
  GrpcDeleteUserDataRequest,
  GrpcDeleteUserDataResponse,
} from "@secureclaw/shared";
import type { SessionContext } from "../../session/session-context.js";
import type { LLMMessage } from "../../llm/provider.interface.js";

export type { GrpcStoredMessage as StoredMemoryMessage };

export class MemoryGrpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(addr?: string) {
    const target = addr ?? process.env["MEMORY_ADDR"] ?? "127.0.0.1:19006";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = loadProto("memory.proto") as any;
    const MemoryServiceClient =
      proto.secureclaw?.memory?.v1?.MemoryService as grpc.ServiceClientConstructor;
    if (!MemoryServiceClient) {
      throw new Error("Failed to load MemoryService from memory.proto");
    }
    this.client = new MemoryServiceClient(target, clientCredentials("agent-runtime"));
  }

  /** Fire-and-forget — never throws */
  storeSession(ctx: SessionContext): void {
    const req: GrpcStoreSessionRequest = {
      session_id: ctx.session_id,
      user_id: ctx.user_id,
      provider: ctx.provider.provider_name,
      created_at: ctx.created_at,
    };
    this.client.StoreSession(req, (err: grpc.ServiceError | null) => {
      if (err) {
        process.stderr.write(`[memory-client] storeSession failed: ${err.message}\n`);
      }
    });
  }

  /** Fire-and-forget — never throws */
  appendMessage(sessionId: string, userId: string, msg: LLMMessage): void {
    const req: GrpcAppendMessageRequest = {
      session_id: sessionId,
      user_id: userId,
      role: msg.role,
      content: msg.content ?? "",
      tool_calls_json:
        msg.role === "assistant" && msg.tool_calls
          ? JSON.stringify(msg.tool_calls)
          : "",
      tool_call_id: msg.role === "tool" ? (msg.tool_call_id ?? "") : "",
      tool_name: msg.role === "tool" ? (msg.tool_name ?? "") : "",
      created_at: Date.now(),
    };
    this.client.AppendMessage(req, (err: grpc.ServiceError | null) => {
      if (err) {
        process.stderr.write(`[memory-client] appendMessage failed: ${err.message}\n`);
      }
    });
  }

  /** Fire-and-forget — never throws */
  finalizeSession(ctx: SessionContext): void {
    const req: GrpcFinalizeSessionRequest = {
      session_id: ctx.session_id,
      ended_at: Date.now(),
      input_tokens: ctx.total_input_tokens,
      output_tokens: ctx.total_output_tokens,
      cost_usd: ctx.total_cost_usd,
      tool_call_count: ctx.tool_call_count,
    };
    this.client.FinalizeSession(req, (err: grpc.ServiceError | null) => {
      if (err) {
        process.stderr.write(`[memory-client] finalizeSession failed: ${err.message}\n`);
      }
    });
  }

  /**
   * Load the N most recent messages for a user across all sessions.
   *
   * On the critical path for the first turn of each session.
   * Resolves with [] on timeout (2 seconds) or any error — never rejects.
   * Returned messages are in chronological order (oldest first).
   */
  getRecentMessages(userId: string, limit = 30): Promise<GrpcStoredMessage[]> {
    return new Promise((resolve) => {
      const req: GrpcGetRecentMessagesRequest = { user_id: userId, limit };

      const timer = setTimeout(() => {
        process.stderr.write(
          `[memory-client] getRecentMessages timed out for user ${userId}\n`
        );
        resolve([]);
      }, 2_000);

      this.client.GetRecentMessages(
        req,
        (err: grpc.ServiceError | null, res: GrpcGetRecentMessagesResponse) => {
          clearTimeout(timer);
          if (err) {
            process.stderr.write(
              `[memory-client] getRecentMessages failed: ${err.message}\n`
            );
            resolve([]);
            return;
          }
          resolve(res.messages ?? []);
        }
      );
    });
  }

  /** Awaitable — used for explicit GDPR erasure requests */
  deleteUserData(userId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req: GrpcDeleteUserDataRequest = { user_id: userId };
      this.client.DeleteUserData(
        req,
        (err: grpc.ServiceError | null, res: GrpcDeleteUserDataResponse) => {
          if (err) { reject(err); return; }
          resolve(Number(res.deleted_count));
        }
      );
    });
  }

  close(): void {
    this.client.close();
  }
}
