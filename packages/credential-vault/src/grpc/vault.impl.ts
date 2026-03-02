/**
 * vault.impl.ts — VaultService gRPC handler implementations.
 *
 * CRITICAL SECURITY INVARIANT:
 * Raw secret values are NEVER returned over gRPC.
 * SetSecret: write-only (value consumed immediately, ref_id returned)
 * InjectCredential: mutated input passed back (never raw value)
 */
import type * as grpc from "@grpc/grpc-js";
import type { VaultService } from "../vault.service.js";
import type {
  GrpcSetSecretRequest,
  GrpcSetSecretResponse,
  GrpcGetSecretRefRequest,
  GrpcGetSecretRefResponse,
  GrpcDeleteSecretRequest,
  GrpcDeleteSecretResponse,
  GrpcListSecretRefsRequest,
  GrpcListSecretRefsResponse,
  GrpcInjectCredentialRequest,
  GrpcInjectCredentialResponse,
  GrpcScanRequest,
  GrpcScanResponse,
} from "@tessera/shared";

type UnaryCall<Req, Res> = grpc.ServerUnaryCall<Req, Res>;
type Callback<Res> = grpc.sendUnaryData<Res>;

export function makeVaultImpl(vaultSvc: VaultService) {
  return {
    SetSecret(
      call: UnaryCall<GrpcSetSecretRequest, GrpcSetSecretResponse>,
      callback: Callback<GrpcSetSecretResponse>
    ): void {
      const req = call.request;
      vaultSvc
        .setSecret({ service: req.service, account: req.account, value: req.value })
        .then((result) => callback(null, result))
        .catch((err: unknown) => {
          callback(null, {
            ref_id: "",
            success: false,
            error_message: err instanceof Error ? err.message : String(err),
          });
        });
    },

    GetSecretRef(
      call: UnaryCall<GrpcGetSecretRefRequest, GrpcGetSecretRefResponse>,
      callback: Callback<GrpcGetSecretRefResponse>
    ): void {
      const req = call.request;
      const result = vaultSvc.getSecretRef(req.service, req.account);
      callback(null, result);
    },

    DeleteSecret(
      call: UnaryCall<GrpcDeleteSecretRequest, GrpcDeleteSecretResponse>,
      callback: Callback<GrpcDeleteSecretResponse>
    ): void {
      const req = call.request;
      vaultSvc
        .deleteSecret(req.service, req.account)
        .then((result) => callback(null, result))
        .catch((err: unknown) => {
          callback(null, { success: false });
          process.stderr.write(`[vault-grpc] deleteSecret error: ${String(err)}\n`);
        });
    },

    ListSecretRefs(
      _call: UnaryCall<GrpcListSecretRefsRequest, GrpcListSecretRefsResponse>,
      callback: Callback<GrpcListSecretRefsResponse>
    ): void {
      const { refs } = vaultSvc.listSecretRefs();
      callback(null, { refs });
    },

    InjectCredential(
      call: UnaryCall<GrpcInjectCredentialRequest, GrpcInjectCredentialResponse>,
      callback: Callback<GrpcInjectCredentialResponse>
    ): void {
      const req = call.request;
      vaultSvc
        .injectCredential({
          ref_id: req.ref_id,
          tool_input_json: req.tool_input_json,
          placeholder_key: req.placeholder_key,
        })
        .then((result) => callback(null, result))
        .catch((err: unknown) => {
          callback(null, {
            mutated_input_json: "",
            success: false,
            error_message: err instanceof Error ? err.message : String(err),
          });
        });
    },

    ScanForPlaintextSecrets(
      call: UnaryCall<GrpcScanRequest, GrpcScanResponse>,
      callback: Callback<GrpcScanResponse>
    ): void {
      const result = vaultSvc.scanForPlaintextSecrets(call.request.path);
      callback(null, result);
    },
  };
}
