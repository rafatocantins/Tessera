/**
 * credentials.route.ts — Credential vault management endpoints.
 *
 * SECURITY INVARIANT: Raw secret values are NEVER returned in any response.
 * POST /api/v1/credentials accepts a value, passes it to the vault gRPC service,
 * and only echoes back { ref_id, service, account } — never the value.
 *
 * GET  /api/v1/credentials        — list all stored credential refs (no values)
 * POST /api/v1/credentials        — store a new credential
 * DELETE /api/v1/credentials/:service/:account — revoke a credential
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyToken } from "../plugins/auth.plugin.js";
import type { VaultGrpcClient } from "../grpc/vault.client.js";

declare module "fastify" {
  interface FastifyInstance {
    vaultClient: VaultGrpcClient;
  }
}

export async function credentialsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("preHandler", verifyToken);

  // GET /api/v1/credentials — list all credential refs (service, account, ref_id, created_at)
  fastify.get(
    "/",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      try {
        const refs = await fastify.vaultClient.listSecretRefs();
        await reply.send({ credentials: refs });
      } catch (err) {
        fastify.log.error({ err }, "Failed to list credential refs");
        await reply.code(502).send({ error: "vault_unavailable" });
      }
    }
  );

  // POST /api/v1/credentials — store a new credential
  // Body: { service: string, account: string, value: string }
  // Response: { ref_id, service, account } — value is NEVER echoed back
  fastify.post(
    "/",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{
        Body: { service?: string; account?: string; value?: string };
      }>,
      reply
    ) => {
      const { service, account, value } = req.body;
      if (!service || !account || !value) {
        await reply.code(400).send({ error: "service, account, and value are required" });
        return;
      }
      try {
        const result = await fastify.vaultClient.setSecret(service, account, value);
        // CRITICAL: value is NOT included in the response
        await reply.code(201).send({ ref_id: result.ref_id, service, account });
      } catch (err) {
        fastify.log.error({ err }, "Failed to store credential");
        await reply.code(502).send({ error: "vault_unavailable" });
      }
    }
  );

  // DELETE /api/v1/credentials/:service/:account — revoke a credential
  fastify.delete(
    "/:service/:account",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Params: { service: string; account: string } }>,
      reply
    ) => {
      const { service, account } = req.params;
      try {
        await fastify.vaultClient.deleteSecret(service, account);
        await reply.code(204).send();
      } catch (err) {
        fastify.log.error({ err }, "Failed to delete credential");
        await reply.code(502).send({ error: "vault_unavailable" });
      }
    }
  );
}
