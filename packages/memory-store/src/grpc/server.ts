/**
 * server.ts — MemoryService gRPC server.
 *
 * Binds on MEMORY_ADDR (default 0.0.0.0:19006).
 * Only reachable from within the internal Docker network.
 *
 * mTLS: loads memory-store.crt / memory-store.key from GRPC_CERTS_DIR.
 * Falls back to insecure transport when certs are absent (dev mode).
 */
import { loadProto, grpc, serverCredentials } from "@secureclaw/shared";
import type { MemoryService } from "../memory.service.js";
import { makeMemoryImpl } from "./memory.impl.js";

export function startMemoryGrpcServer(memorySvc: MemoryService): Promise<grpc.Server> {
  const addr = process.env["MEMORY_ADDR"] ?? "0.0.0.0:19006";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = loadProto("memory.proto") as any;
  const MemoryServiceClient =
    proto.secureclaw?.memory?.v1?.MemoryService as grpc.ServiceClientConstructor;

  if (!MemoryServiceClient) {
    throw new Error("Failed to load MemoryService from memory.proto");
  }

  const server = new grpc.Server();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.addService((MemoryServiceClient as any).service, makeMemoryImpl(memorySvc));

  const creds = serverCredentials("memory-store");

  return new Promise((resolve, reject) => {
    server.bindAsync(addr, creds, (err, port) => {
      if (err) {
        reject(err);
        return;
      }
      process.stdout.write(`[memory-grpc] Server listening on ${addr} (port ${port})\n`);
      resolve(server);
    });
  });
}
