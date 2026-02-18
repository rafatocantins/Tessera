/**
 * server.ts — SkillsService gRPC server.
 *
 * Binds on SKILLS_ADDR (default 0.0.0.0:19005).
 * Only reachable from within the internal Docker network.
 *
 * mTLS: loads skills-engine.crt / skills-engine.key from GRPC_CERTS_DIR.
 * Falls back to insecure transport when certs are absent (dev mode).
 */
import { loadProto, grpc, serverCredentials } from "@secureclaw/shared";
import type { SkillRegistry } from "../registry.js";
import type { SandboxGrpcClient } from "../sandbox.client.js";
import { makeSkillsImpl } from "./skills.impl.js";

export function startSkillsGrpcServer(
  registry: SkillRegistry,
  sandbox: SandboxGrpcClient
): Promise<grpc.Server> {
  const addr = process.env["SKILLS_ADDR"] ?? "0.0.0.0:19005";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = loadProto("skills.proto") as any;
  const SkillsService = proto.secureclaw?.skills?.v1?.SkillsService as grpc.ServiceClientConstructor;

  if (!SkillsService) {
    throw new Error("Failed to load SkillsService from skills.proto");
  }

  const server = new grpc.Server();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.addService((SkillsService as any).service, makeSkillsImpl(registry, sandbox));

  const creds = serverCredentials("skills-engine");

  return new Promise((resolve, reject) => {
    server.bindAsync(addr, creds, (err, port) => {
      if (err) {
        reject(err);
        return;
      }
      process.stdout.write(`[skills-grpc] Server listening on ${addr} (port ${port})\n`);
      resolve(server);
    });
  });
}
