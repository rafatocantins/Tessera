/**
 * audit.client.ts — Lightweight gRPC client for the AuditService (gateway side).
 *
 * The gateway only needs GetCostSummary to enforce the daily cost cap before
 * forwarding messages. Full audit logging is handled by agent-runtime.
 */
import { loadProto, grpc, clientCredentials } from "@secureclaw/shared";
import type { GrpcGetCostSummaryRequest, GrpcGetCostSummaryResponse } from "@secureclaw/shared";

export interface CostSummary {
  total_cost_usd: number;
  cap_usd: number;
  remaining_usd: number;
  cap_exceeded: boolean;
}

export class AuditGrpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(addr?: string) {
    const target = addr ?? process.env["AUDIT_ADDR"] ?? "127.0.0.1:19003";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = loadProto("audit.proto") as any;
    const AuditServiceClient = proto.secureclaw?.audit?.v1?.AuditService as grpc.ServiceClientConstructor;
    if (!AuditServiceClient) {
      throw new Error("Failed to load AuditService from audit.proto");
    }
    this.client = new AuditServiceClient(target, clientCredentials("gateway"));
  }

  getCostSummary(userId: string, dayMs?: number): Promise<CostSummary> {
    return new Promise((resolve, reject) => {
      const req: GrpcGetCostSummaryRequest = {
        user_id: userId,
        day_unix_ms: dayMs ?? Date.now(),
      };
      this.client.GetCostSummary(
        req,
        (err: grpc.ServiceError | null, res: GrpcGetCostSummaryResponse) => {
          if (err) { reject(err); return; }
          resolve({
            total_cost_usd: res.total_cost_usd,
            cap_usd: res.cap_usd,
            remaining_usd: res.remaining_usd,
            cap_exceeded: res.cap_exceeded,
          });
        }
      );
    });
  }

  close(): void {
    this.client.close();
  }
}
