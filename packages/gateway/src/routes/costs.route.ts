/**
 * costs.route.ts — Team cost showback/chargeback endpoints.
 *
 * GET /api/v1/costs/teams?from=&to=          → all teams summary (JSON)
 * GET /api/v1/costs/teams/:teamId?from=&to=  → single team details (JSON)
 * GET /api/v1/costs/export?from=&to=         → all teams as CSV download
 *
 * Auth: HMAC token required.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyToken } from "../plugins/auth.plugin.js";
import type { AuditGrpcClient } from "../grpc/audit.client.js";

export interface CostsRouteOptions {
  auditClient: AuditGrpcClient;
}

export async function costsRoute(
  fastify: FastifyInstance,
  opts: CostsRouteOptions
): Promise<void> {
  fastify.addHook("preHandler", verifyToken);

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // GET /teams — all teams summary
  fastify.get(
    "/teams",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Querystring: { from?: string; to?: string } }>,
      reply
    ) => {
      const toMs = req.query.to ? parseInt(req.query.to, 10) : Date.now();
      const fromMs = req.query.from ? parseInt(req.query.from, 10) : toMs - THIRTY_DAYS_MS;

      try {
        const summary = await opts.auditClient.getTeamCostSummary("", fromMs, toMs);
        await reply.send(summary);
      } catch (err) {
        fastify.log.error({ err }, "Failed to get team cost summary");
        await reply.code(502).send({ error: "costs_unavailable" });
      }
    }
  );

  // GET /teams/:teamId — single team details
  fastify.get(
    "/teams/:teamId",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Params: { teamId: string }; Querystring: { from?: string; to?: string } }>,
      reply
    ) => {
      const { teamId } = req.params;
      const toMs = req.query.to ? parseInt(req.query.to, 10) : Date.now();
      const fromMs = req.query.from ? parseInt(req.query.from, 10) : toMs - THIRTY_DAYS_MS;

      try {
        const summary = await opts.auditClient.getTeamCostSummary(teamId, fromMs, toMs);
        // Return the specific team's entry (or empty result)
        const team = summary.teams.find((t) => t.team_id === teamId) ?? null;
        await reply.send({ team, grand_total_usd: summary.grand_total_usd });
      } catch (err) {
        fastify.log.error({ err }, "Failed to get team cost detail");
        await reply.code(502).send({ error: "costs_unavailable" });
      }
    }
  );

  // GET /export — CSV download for FinOps tools
  fastify.get(
    "/export",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Querystring: { from?: string; to?: string } }>,
      reply
    ) => {
      const toMs = req.query.to ? parseInt(req.query.to, 10) : Date.now();
      const fromMs = req.query.from ? parseInt(req.query.from, 10) : toMs - THIRTY_DAYS_MS;

      try {
        const summary = await opts.auditClient.getTeamCostSummary("", fromMs, toMs);
        const header = "team_id,total_cost_usd,input_tokens,output_tokens,session_count\n";
        const rows = summary.teams
          .map((t) =>
            `${t.team_id},${t.total_cost_usd.toFixed(6)},${t.input_tokens},${t.output_tokens},${t.session_count}`
          )
          .join("\n");
        const csv = header + rows;

        await reply
          .header("Content-Disposition", 'attachment; filename="tessera-costs.csv"')
          .header("Content-Type", "text/csv")
          .send(csv);
      } catch (err) {
        fastify.log.error({ err }, "Failed to export costs CSV");
        await reply.code(502).send({ error: "costs_unavailable" });
      }
    }
  );
}
