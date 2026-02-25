/**
 * compliance.route.ts — EU AI Act compliance report endpoints.
 *
 * GET /api/v1/compliance/report?from=<unix_ms>&to=<unix_ms>
 * GET /api/v1/compliance/report/export  (same, adds Content-Disposition for download)
 *
 * Auth: HMAC token required.
 * Rate: 10/min (compliance reports can be heavy).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyToken } from "../plugins/auth.plugin.js";
import type { AuditGrpcClient } from "../grpc/audit.client.js";

export interface ComplianceRouteOptions {
  auditClient: AuditGrpcClient;
}

export async function complianceRoute(
  fastify: FastifyInstance,
  opts: ComplianceRouteOptions
): Promise<void> {
  fastify.addHook("preHandler", verifyToken);

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // GET /report
  fastify.get(
    "/report",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Querystring: { from?: string; to?: string } }>,
      reply
    ) => {
      const toMs = req.query.to ? parseInt(req.query.to, 10) : Date.now();
      const fromMs = req.query.from ? parseInt(req.query.from, 10) : toMs - THIRTY_DAYS_MS;

      try {
        const report = await opts.auditClient.getComplianceReport(fromMs, toMs);
        await reply.send(report);
      } catch (err) {
        fastify.log.error({ err }, "Failed to generate compliance report");
        await reply.code(502).send({ error: "compliance_unavailable" });
      }
    }
  );

  // GET /report/export — same data with Content-Disposition
  fastify.get(
    "/report/export",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Querystring: { from?: string; to?: string } }>,
      reply
    ) => {
      const toMs = req.query.to ? parseInt(req.query.to, 10) : Date.now();
      const fromMs = req.query.from ? parseInt(req.query.from, 10) : toMs - THIRTY_DAYS_MS;

      try {
        const report = await opts.auditClient.getComplianceReport(fromMs, toMs);
        await reply
          .header("Content-Disposition", 'attachment; filename="eu-ai-act-report.json"')
          .header("Content-Type", "application/json")
          .send(JSON.stringify(report, null, 2));
      } catch (err) {
        fastify.log.error({ err }, "Failed to export compliance report");
        await reply.code(502).send({ error: "compliance_unavailable" });
      }
    }
  );
}
