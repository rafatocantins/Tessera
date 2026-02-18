/**
 * server.ts — SandboxService gRPC server.
 *
 * Binds on SANDBOX_ADDR (default 0.0.0.0:19004).
 * Only reachable from within the internal Docker network.
 *
 * mTLS: loads sandbox-runtime.crt / sandbox-runtime.key from GRPC_CERTS_DIR.
 * Falls back to insecure transport when certs are absent (dev mode).
 */
import { loadProto, grpc, serverCredentials } from "@secureclaw/shared";
import type { SandboxService } from "../sandbox.service.js";
import { makeSandboxImpl } from "./sandbox.impl.js";

export function startSandboxGrpcServer(sandboxSvc: SandboxService): Promise<grpc.Server> {
  const addr = process.env["SANDBOX_ADDR"] ?? "0.0.0.0:19004";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = loadProto("sandbox.proto") as any;
  const SandboxServiceDef = proto.secureclaw?.sandbox?.v1?.SandboxService as grpc.ServiceClientConstructor;

  if (!SandboxServiceDef) {
    throw new Error("Failed to load SandboxService from sandbox.proto");
  }

  const server = new grpc.Server();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.addService((SandboxServiceDef as any).service, makeSandboxImpl(sandboxSvc));

  const creds = serverCredentials("sandbox-runtime");

  return new Promise((resolve, reject) => {
    server.bindAsync(addr, creds, (err, port) => {
      if (err) {
        reject(err);
        return;
      }
      process.stdout.write(`[sandbox-grpc] Server listening on ${addr} (port ${port})\n`);
      resolve(server);
    });
  });
}
