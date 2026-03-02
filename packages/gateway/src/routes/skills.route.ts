/**
 * skills.route.ts — Direct skill management REST endpoints.
 *
 * Authenticated (HMAC token required):
 *   GET  /api/v1/skills              → list installed skills
 *   POST /api/v1/skills              → install a signed manifest directly (bypass marketplace)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyToken } from "../plugins/auth.plugin.js";
import type { SkillsGrpcClient } from "../grpc/skills.client.js";

export interface SkillsRouteOptions {
  skillsClient: SkillsGrpcClient;
}

export async function skillsRoute(
  fastify: FastifyInstance,
  opts: SkillsRouteOptions
): Promise<void> {
  fastify.addHook("preHandler", verifyToken);

  // GET / — list installed skills
  fastify.get(
    "/",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Querystring: { namespace?: string; tag?: string } }>,
      reply
    ) => {
      try {
        const result = await opts.skillsClient.listInstalledSkills(
          req.query.namespace,
          req.query.tag,
        );
        await reply.send({ skills: result.skills ?? [] });
      } catch (err) {
        fastify.log.error({ err }, "Failed to list installed skills");
        await reply.code(502).send({ error: "skills_engine_unavailable" });
      }
    }
  );

  // POST / — install from a signed manifest
  fastify.post(
    "/",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req: FastifyRequest, reply) => {
      const body = req.body as { manifest_json?: unknown; force?: unknown } | null;
      const manifest_json = body?.manifest_json;
      const force = Boolean(body?.force ?? false);

      if (!manifest_json || typeof manifest_json !== "string") {
        await reply.code(400).send({ error: "bad_request", message: "manifest_json is required" });
        return;
      }

      try {
        const result = await opts.skillsClient.installSkill(manifest_json, force);
        if (!result.success) {
          await reply.code(400).send({ error: "install_failed", message: result.message });
          return;
        }
        await reply.code(201).send({
          success: true,
          skill_id: result.skill_id,
          skill_version: result.skill_version,
          tools_registered: result.tools_registered,
          message: result.message,
        });
      } catch (err) {
        fastify.log.error({ err }, "Failed to install skill");
        await reply.code(502).send({ error: "skills_engine_unavailable" });
      }
    }
  );
}
