/**
 * marketplace.route.ts — Skills marketplace REST endpoints.
 *
 * Public (no auth):
 *   GET /api/v1/marketplace                        → list all skills
 *   GET /api/v1/marketplace/:ns/:name?version=     → get skill detail
 *
 * Authenticated (HMAC token required):
 *   POST /api/v1/marketplace/publish               → publish a skill
 *   POST /api/v1/marketplace/install/:ns/:name/:version → install from marketplace
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyToken } from "../plugins/auth.plugin.js";
import type { SkillsGrpcClient } from "../grpc/skills.client.js";

export interface MarketplaceRouteOptions {
  skillsClient: SkillsGrpcClient;
}

export async function marketplaceRoute(
  fastify: FastifyInstance,
  opts: MarketplaceRouteOptions
): Promise<void> {
  // ── Public routes (no auth required) ─────────────────────────────────────

  // GET / — public listing
  fastify.get(
    "/",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Querystring: { namespace?: string; tag?: string; search?: string } }>,
      reply
    ) => {
      try {
        const result = await opts.skillsClient.listMarketplaceSkills(
          req.query.namespace,
          req.query.tag,
          req.query.search
        );
        await reply.send({ skills: result.skills ?? [] });
      } catch (err) {
        fastify.log.error({ err }, "Failed to list marketplace skills");
        await reply.code(502).send({ error: "marketplace_unavailable" });
      }
    }
  );

  // GET /:ns/:name — public skill detail
  fastify.get(
    "/:ns/:name",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Params: { ns: string; name: string }; Querystring: { version?: string } }>,
      reply
    ) => {
      const skillId = `${(req.params as { ns: string; name: string }).ns}/${(req.params as { ns: string; name: string }).name}`;
      const version = (req.query as { version?: string }).version;
      try {
        const result = await opts.skillsClient.getMarketplaceSkill(skillId, version);
        if (!result.found) {
          await reply.code(404).send({ error: "not_found", skill_id: skillId });
          return;
        }
        await reply.send({
          skill_id: skillId,
          manifest_json: result.manifest_json,
          download_count: result.download_count,
        });
      } catch (err) {
        fastify.log.error({ err }, "Failed to get marketplace skill");
        await reply.code(502).send({ error: "marketplace_unavailable" });
      }
    }
  );

  // ── Authenticated routes (HMAC token required) ────────────────────────────
  await fastify.register(async (auth) => {
    auth.addHook("preHandler", verifyToken);

    // POST /publish — rate-limited
    auth.post(
      "/publish",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (req: FastifyRequest, reply) => {
        const body = req.body as { manifest_json?: unknown; trivy_scan_passed?: unknown } | null;
        const manifest_json = body?.manifest_json;
        const trivy_scan_passed = body?.trivy_scan_passed ?? false;

        if (!manifest_json || typeof manifest_json !== "string") {
          await reply.code(400).send({ error: "bad_request", message: "manifest_json is required" });
          return;
        }
        try {
          const result = await opts.skillsClient.publishSkill(manifest_json, Boolean(trivy_scan_passed));
          if (!result.success) {
            await reply.code(400).send({ error: "publish_failed", message: result.message });
            return;
          }
          await reply.code(201).send({
            success: true,
            skill_id: result.skill_id,
            version: result.version,
            message: result.message,
          });
        } catch (err) {
          fastify.log.error({ err }, "Failed to publish skill");
          await reply.code(502).send({ error: "marketplace_unavailable" });
        }
      }
    );

    // POST /install/:ns/:name/:version — rate-limited
    auth.post(
      "/install/:ns/:name/:version",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (req: FastifyRequest, reply) => {
        const params = req.params as { ns: string; name: string; version: string };
        const skillId = `${params.ns}/${params.name}`;
        const version = params.version;
        try {
          const result = await opts.skillsClient.installFromMarketplace(skillId, version);
          if (!result.success) {
            await reply.code(400).send({ error: "install_failed", message: result.message });
            return;
          }
          await reply.send({
            success: true,
            skill_id: result.skill_id,
            skill_version: result.skill_version,
            tools_registered: result.tools_registered,
            message: result.message,
          });
        } catch (err) {
          fastify.log.error({ err }, "Failed to install skill from marketplace");
          await reply.code(502).send({ error: "marketplace_unavailable" });
        }
      }
    );
  });
}
