/**
 * approvals.route.ts — Pending tool approval listing endpoint.
 *
 * GET /api/v1/approvals — returns all pending approval requests across all
 * active agent sessions. Used by the Control UI approval queue dashboard.
 *
 * Approve/deny is handled by the existing:
 * POST /api/v1/sessions/:id/approve/:callId
 */
import type { FastifyInstance } from "fastify";
import { verifyToken } from "../plugins/auth.plugin.js";
import type { AgentGrpcClient } from "../grpc/agent.client.js";

declare module "fastify" {
  interface FastifyInstance {
    agentClient: AgentGrpcClient;
  }
}

export async function approvalsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("preHandler", verifyToken);

  fastify.get(
    "/",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      try {
        const approvals = await fastify.agentClient.listPendingApprovals();
        await reply.send({ approvals });
      } catch (err) {
        fastify.log.error({ err }, "Failed to list pending approvals");
        await reply.code(502).send({ error: "agent_unavailable" });
      }
    }
  );
}
