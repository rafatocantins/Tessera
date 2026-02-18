/**
 * agent.client.ts — gRPC client for the AgentService.
 *
 * Used by the gateway to forward WebSocket messages to the agent runtime.
 * The sendMessage call returns an async iterable of AgentChunk messages.
 */
import { loadProto, grpc, clientCredentials } from "@secureclaw/shared";
import type {
  GrpcCreateSessionRequest,
  GrpcCreateSessionResponse,
  GrpcSendMessageRequest,
  GrpcAgentChunk,
  GrpcApproveToolCallRequest,
  GrpcTerminateSessionRequest,
  GrpcTerminateSessionResponse,
  GrpcGetSessionStatusRequest,
  GrpcGetSessionStatusResponse,
} from "@secureclaw/shared";

export interface SessionStatus {
  session_id: string;
  status: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  tool_call_count: number;
}

export class AgentGrpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(addr?: string) {
    const target = addr ?? process.env["AGENT_RUNTIME_ADDR"] ?? "127.0.0.1:19001";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = loadProto("agent.proto") as any;
    const AgentServiceClient = proto.secureclaw?.agent?.v1?.AgentService as grpc.ServiceClientConstructor;
    if (!AgentServiceClient) {
      throw new Error("Failed to load AgentService from agent.proto");
    }
    this.client = new AgentServiceClient(target, clientCredentials("gateway"));
  }

  createSession(
    userId: string,
    provider: string,
    metadata: Record<string, string> = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req: GrpcCreateSessionRequest = { user_id: userId, provider, metadata };
      this.client.CreateSession(
        req,
        (err: grpc.ServiceError | null, res: GrpcCreateSessionResponse) => {
          if (err) { reject(err); return; }
          if (!res.success) { reject(new Error(res.error_message || "CreateSession failed")); return; }
          resolve(res.session_id);
        }
      );
    });
  }

  /**
   * Stream agent chunks for a user message.
   * Returns an async generator that yields GrpcAgentChunk objects.
   */
  sendMessage(sessionId: string, content: string): AsyncGenerator<GrpcAgentChunk> {
    const req: GrpcSendMessageRequest = {
      session_id: sessionId,
      content,
      content_type: "user_instruction",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = this.client.SendMessage(req) as any;

    return (async function* () {
      for await (const chunk of call) {
        yield chunk as GrpcAgentChunk;
      }
    })();
  }

  approveToolCall(sessionId: string, callId: string, approved: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const req: GrpcApproveToolCallRequest = { session_id: sessionId, call_id: callId, approved };
      this.client.ApproveToolCall(req, (err: grpc.ServiceError | null) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });
  }

  terminateSession(sessionId: string): Promise<{ success: boolean; total_cost_usd: number }> {
    return new Promise((resolve, reject) => {
      const req: GrpcTerminateSessionRequest = { session_id: sessionId };
      this.client.TerminateSession(
        req,
        (err: grpc.ServiceError | null, res: GrpcTerminateSessionResponse) => {
          if (err) { reject(err); return; }
          resolve({ success: res.success, total_cost_usd: res.total_cost_usd });
        }
      );
    });
  }

  getSessionStatus(sessionId: string): Promise<SessionStatus> {
    return new Promise((resolve, reject) => {
      const req: GrpcGetSessionStatusRequest = { session_id: sessionId };
      this.client.GetSessionStatus(
        req,
        (err: grpc.ServiceError | null, res: GrpcGetSessionStatusResponse) => {
          if (err) { reject(err); return; }
          resolve(res);
        }
      );
    });
  }

  close(): void {
    this.client.close();
  }
}
