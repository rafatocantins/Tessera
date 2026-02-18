/**
 * sessions.route.ts — Session management REST endpoints.
 *
 * POST /sessions — Create a new agent session
 * GET /sessions/:id — Get session status
 * DELETE /sessions/:id — Terminate a session
 * POST /sessions/:id/approve/:callId — Respond to a tool approval request
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { CreateSessionRequestSchema } from "@secureclaw/shared";
import { verifyToken, blockTokenInQueryParams } from "../plugins/auth.plugin.js";
import type { AgentGrpcClient } from "../grpc/agent.client.js";

declare module "fastify" {
  interface FastifyInstance {
    agentClient: AgentGrpcClient;
  }
}

export async function sessionsRoute(fastify: FastifyInstance): Promise<void> {
  // Apply security hooks to all session routes
  fastify.addHook("onRequest", blockTokenInQueryParams);
  fastify.addHook("preHandler", verifyToken);

  // POST /sessions — Create new session
  // Strict limit: session creation is expensive; 10/min prevents flooding.
  fastify.post("/", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId;
    if (!userId) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }

    const parseResult = CreateSessionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      await reply.code(400).send({
        error: "validation_error",
        issues: parseResult.error.issues,
      });
      return;
    }

    const { provider, metadata } = parseResult.data;

    try {
      const sessionId = await fastify.agentClient.createSession(
        userId,
        provider,
        metadata as Record<string, string> | undefined ?? {}
      );
      await reply.code(201).send({ session_id: sessionId, status: "active" });
    } catch (err) {
      fastify.log.error({ err }, "Failed to create session");
      await reply.code(502).send({
        error: "agent_unavailable",
        message: err instanceof Error ? err.message : "Failed to create session",
      });
    }
  });

  // GET /sessions/:id — Get session status
  fastify.get(
    "/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      try {
        const status = await fastify.agentClient.getSessionStatus(id);
        await reply.send(status);
      } catch (err) {
        fastify.log.error({ err, sessionId: id }, "Failed to get session status");
        await reply.code(502).send({ error: "agent_unavailable" });
      }
    }
  );

  // DELETE /sessions/:id — Terminate session
  fastify.delete(
    "/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      try {
        const result = await fastify.agentClient.terminateSession(id);
        await reply.send({ session_id: id, terminated: result.success, total_cost_usd: result.total_cost_usd });
      } catch (err) {
        fastify.log.error({ err, sessionId: id }, "Failed to terminate session");
        await reply.code(502).send({ error: "agent_unavailable" });
      }
    }
  );

  // POST /sessions/:id/approve/:callId — Human approval for tool calls
  // Keyed by sessionId so each session has its own 20/min budget.
  fastify.post(
    "/:id/approve/:callId",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (req) => {
            const params = req.params as { id: string };
            return `approve:${params.id}`;
          },
        },
      },
    },
    async (
      req: FastifyRequest<{
        Params: { id: string; callId: string };
        Body: { approved: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { id: sessionId, callId } = req.params;
      const body = req.body as { approved?: boolean };
      const approved = Boolean(body.approved);

      try {
        await fastify.agentClient.approveToolCall(sessionId, callId, approved);
        await reply.send({ call_id: callId, approved });
      } catch (err) {
        fastify.log.error({ err, sessionId, callId }, "Failed to process approval");
        await reply.code(502).send({ error: "agent_unavailable" });
      }
    }
  );
}
