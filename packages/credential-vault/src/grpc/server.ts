/**
 * server.ts — VaultService gRPC server.
 *
 * Binds on VAULT_ADDR (default 0.0.0.0:19002).
 * Only reachable from within the internal Docker network.
 *
 * mTLS: loads credential-vault.crt / credential-vault.key from GRPC_CERTS_DIR.
 * Falls back to insecure transport when certs are absent (dev mode).
 */
import { loadProto, grpc, serverCredentials } from "@tessera/shared";
import type { VaultService } from "../vault.service.js";
import { makeVaultImpl } from "./vault.impl.js";

export function startVaultGrpcServer(vaultSvc: VaultService): Promise<grpc.Server> {
  const addr = process.env["VAULT_ADDR"] ?? "0.0.0.0:19002";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = loadProto("vault.proto") as any;
  const VaultServiceDef = proto.tessera?.vault?.v1?.VaultService as grpc.ServiceClientConstructor;

  if (!VaultServiceDef) {
    throw new Error("Failed to load VaultService from vault.proto");
  }

  const server = new grpc.Server();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.addService((VaultServiceDef as any).service, makeVaultImpl(vaultSvc));

  const creds = serverCredentials("credential-vault");

  return new Promise((resolve, reject) => {
    server.bindAsync(addr, creds, (err, port) => {
      if (err) {
        reject(err);
        return;
      }
      process.stdout.write(`[vault-grpc] Server listening on ${addr} (port ${port})\n`);
      resolve(server);
    });
  });
}
