/**
 * health.route.ts — Health check endpoint.
 *
 * No authentication required (used by Docker healthcheck).
 * ONLY available on loopback (127.0.0.1) — not exposed externally.
 * Returns minimal information to avoid leaking operational details.
 */
import type { FastifyInstance } from "fastify";

export async function healthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/",
    // Exempt from rate limiting — Docker healthchecks must always succeed
    { config: { rateLimit: false } },
    async (_req, reply) => {
      await reply.send({ status: "ok", service: "secureclaw-gateway" });
    }
  );
}
