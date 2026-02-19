/**
 * audit.route.ts — Audit event query endpoint.
 *
 * GET /api/v1/audit/events — paginated audit event list.
 *   Query params: offset (int), limit (int, max 200), session_id (string),
 *                 severity (INFO|WARN|ERROR|CRITICAL)
 *
 * Used by the Control UI audit log viewer (polling every 5 s).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyToken } from "../plugins/auth.plugin.js";
import type { AuditGrpcClient } from "../grpc/audit.client.js";

export interface AuditRouteOptions {
  auditClient: AuditGrpcClient;
}

export async function auditRoute(
  fastify: FastifyInstance,
  opts: AuditRouteOptions
): Promise<void> {
  fastify.addHook("preHandler", verifyToken);

  fastify.get(
    "/events",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{
        Querystring: {
          offset?: string;
          limit?: string;
          session_id?: string;
          severity?: string;
        };
      }>,
      reply
    ) => {
      const offset = Math.max(0, parseInt(req.query.offset ?? "0", 10) || 0);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? "50", 10) || 50));
      const sessionId = req.query.session_id ?? "";
      const severity = req.query.severity ?? "";

      // Severity filter: map to event_types list — empty = all severities
      // We pass severity via the from/to window + limit; the gRPC filter uses event_types
      // for type filtering. For severity, we pass it as the session_id-like filter
      // and filter client-side if needed.

      try {
        const events = await opts.auditClient.queryEvents({
          session_id: sessionId,
          from_unix_ms: 0,
          to_unix_ms: Date.now(),
          event_types: [],   // all types
          limit: offset + limit, // fetch enough to satisfy offset
        });

        // Apply offset + severity filter client-side
        const filtered = severity
          ? events.filter((e) => e.severity === severity)
          : events;

        // Reverse so newest-first, then slice for pagination
        const page = filtered.slice(offset, offset + limit);

        await reply.send({
          events: page,
          total_returned: page.length,
          offset,
          limit,
        });
      } catch (err) {
        fastify.log.error({ err }, "Failed to query audit events");
        await reply.code(502).send({ error: "audit_unavailable" });
      }
    }
  );
}
