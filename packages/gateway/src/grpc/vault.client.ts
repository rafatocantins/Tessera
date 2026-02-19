/**
 * vault.client.ts — Lightweight gRPC client for the VaultService (gateway side).
 *
 * SECURITY: Raw secret values are NEVER transmitted back over gRPC.
 * SetSecret is write-only: the value goes in, only a ref_id comes out.
 * All other operations work with opaque ref_id UUIDs.
 */
import { loadProto, grpc, clientCredentials } from "@secureclaw/shared";
import type {
  GrpcSetSecretRequest,
  GrpcSetSecretResponse,
  GrpcDeleteSecretRequest,
  GrpcDeleteSecretResponse,
  GrpcListSecretRefsResponse,
  GrpcSecretRef,
  GrpcGetSecretRefRequest,
  GrpcGetSecretRefResponse,
} from "@secureclaw/shared";

export class VaultGrpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(addr?: string) {
    const target = addr ?? process.env["VAULT_ADDR"] ?? "127.0.0.1:19002";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = loadProto("vault.proto") as any;
    const VaultServiceClient = proto.secureclaw?.vault?.v1?.VaultService as grpc.ServiceClientConstructor;
    if (!VaultServiceClient) {
      throw new Error("Failed to load VaultService from vault.proto");
    }
    this.client = new VaultServiceClient(target, clientCredentials("gateway"));
  }

  listSecretRefs(): Promise<GrpcSecretRef[]> {
    return new Promise((resolve, reject) => {
      this.client.ListSecretRefs(
        {},
        (err: grpc.ServiceError | null, res: GrpcListSecretRefsResponse) => {
          if (err) { reject(err); return; }
          resolve(res.refs ?? []);
        }
      );
    });
  }

  setSecret(service: string, account: string, value: string): Promise<{ ref_id: string }> {
    return new Promise((resolve, reject) => {
      const req: GrpcSetSecretRequest = { service, account, value };
      this.client.SetSecret(
        req,
        (err: grpc.ServiceError | null, res: GrpcSetSecretResponse) => {
          if (err) { reject(err); return; }
          if (!res.success) {
            reject(new Error(res.error_message || "SetSecret failed"));
            return;
          }
          resolve({ ref_id: res.ref_id });
        }
      );
    });
  }

  deleteSecret(service: string, account: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req: GrpcDeleteSecretRequest = { service, account };
      this.client.DeleteSecret(
        req,
        (err: grpc.ServiceError | null, res: GrpcDeleteSecretResponse) => {
          if (err) { reject(err); return; }
          if (!res.success) {
            reject(new Error("DeleteSecret failed"));
            return;
          }
          resolve();
        }
      );
    });
  }

  getSecretRef(service: string, account: string): Promise<GrpcGetSecretRefResponse> {
    return new Promise((resolve, reject) => {
      const req: GrpcGetSecretRefRequest = { service, account };
      this.client.GetSecretRef(
        req,
        (err: grpc.ServiceError | null, res: GrpcGetSecretRefResponse) => {
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
