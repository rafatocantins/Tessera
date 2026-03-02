/**
 * vault.client.ts — gRPC client for the VaultService.
 *
 * Used by AgentLoop to inject credentials into tool inputs before sandbox execution.
 * Raw secret values are NEVER seen by this client — we get back mutated JSON.
 */
import { loadProto, grpc, clientCredentials } from "@tessera/shared";
import type {
  GrpcInjectCredentialRequest,
  GrpcInjectCredentialResponse,
  GrpcGetSecretRefRequest,
  GrpcGetSecretRefResponse,
} from "@tessera/shared";

export class VaultGrpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(addr?: string) {
    const target = addr ?? process.env["VAULT_ADDR"] ?? "127.0.0.1:19002";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = loadProto("vault.proto") as any;
    const VaultServiceClient = proto.tessera?.vault?.v1?.VaultService as grpc.ServiceClientConstructor;
    if (!VaultServiceClient) {
      throw new Error("Failed to load VaultService from vault.proto");
    }
    this.client = new VaultServiceClient(target, clientCredentials("agent-runtime"));
  }

  injectCredential(refId: string, toolInputJson: string, placeholderKey: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req: GrpcInjectCredentialRequest = {
        ref_id: refId,
        tool_input_json: toolInputJson,
        placeholder_key: placeholderKey,
      };
      this.client.InjectCredential(req, (err: grpc.ServiceError | null, res: GrpcInjectCredentialResponse) => {
        if (err) {
          reject(err);
          return;
        }
        if (!res.success) {
          reject(new Error(res.error_message || "InjectCredential failed"));
          return;
        }
        resolve(res.mutated_input_json);
      });
    });
  }

  getSecretRef(service: string, account: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const req: GrpcGetSecretRefRequest = { service, account };
      this.client.GetSecretRef(req, (err: grpc.ServiceError | null, res: GrpcGetSecretRefResponse) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res.exists ? res.ref_id : null);
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
