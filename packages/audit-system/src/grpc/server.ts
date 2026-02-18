/**
 * server.ts — AuditService gRPC server.
 *
 * Binds on AUDIT_ADDR (default 0.0.0.0:19003).
 * Only reachable from within the internal Docker network.
 *
 * mTLS: loads audit-system.crt / audit-system.key from GRPC_CERTS_DIR.
 * Falls back to insecure transport when certs are absent (dev mode).
 */
import { loadProto, grpc, serverCredentials } from "@secureclaw/shared";
import type { AuditService } from "../audit.service.js";
import { makeAuditImpl } from "./audit.impl.js";

export function startAuditGrpcServer(auditSvc: AuditService): Promise<grpc.Server> {
  const addr = process.env["AUDIT_ADDR"] ?? "0.0.0.0:19003";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = loadProto("audit.proto") as any;
  const AuditService = proto.secureclaw?.audit?.v1?.AuditService as grpc.ServiceClientConstructor;

  if (!AuditService) {
    throw new Error("Failed to load AuditService from audit.proto");
  }

  const server = new grpc.Server();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.addService((AuditService as any).service, makeAuditImpl(auditSvc));

  const creds = serverCredentials("audit-system");

  return new Promise((resolve, reject) => {
    server.bindAsync(addr, creds, (err, port) => {
      if (err) {
        reject(err);
        return;
      }
      process.stdout.write(`[audit-grpc] Server listening on ${addr} (port ${port})\n`);
      resolve(server);
    });
  });
}
