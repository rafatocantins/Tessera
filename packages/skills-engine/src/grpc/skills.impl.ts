/**
 * skills.impl.ts — SkillsService gRPC handler implementations.
 *
 * Delegates to SkillRegistry for install/list/get/remove and to
 * SandboxGrpcClient for tool execution.
 */
import type * as grpc from "@grpc/grpc-js";
import type { SkillRegistry } from "../registry.js";
import type { SandboxGrpcClient } from "../sandbox.client.js";
import type {
  GrpcInstallSkillRequest,
  GrpcInstallSkillResponse,
  GrpcListSkillsRequest,
  GrpcListSkillsResponse,
  GrpcSkillSummary,
  GrpcGetSkillRequest,
  GrpcGetSkillResponse,
  GrpcRemoveSkillRequest,
  GrpcRemoveSkillResponse,
  GrpcExecuteSkillToolRequest,
  GrpcExecuteSkillToolResponse,
} from "@secureclaw/shared";

type UnaryCall<Req, Res> = grpc.ServerUnaryCall<Req, Res>;
type Callback<Res> = grpc.sendUnaryData<Res>;

export function makeSkillsImpl(registry: SkillRegistry, sandbox: SandboxGrpcClient) {
  return {
    InstallSkill(
      call: UnaryCall<GrpcInstallSkillRequest, GrpcInstallSkillResponse>,
      callback: Callback<GrpcInstallSkillResponse>
    ): void {
      try {
        const result = registry.install(call.request.manifest_json, call.request.force ?? false);
        callback(null, {
          success: result.success,
          message: result.message,
          skill_id: result.skill_id ?? "",
          skill_version: result.skill_version ?? "",
          tools_registered: result.tools_registered ?? 0,
        });
      } catch (err) {
        callback(null, {
          success: false,
          message: `Unexpected error: ${String(err)}`,
          skill_id: "",
          skill_version: "",
          tools_registered: 0,
        });
      }
    },

    ListSkills(
      call: UnaryCall<GrpcListSkillsRequest, GrpcListSkillsResponse>,
      callback: Callback<GrpcListSkillsResponse>
    ): void {
      try {
        const skills = registry.list(
          call.request.namespace_filter || undefined,
          call.request.tag_filter || undefined
        );
        const summaries: GrpcSkillSummary[] = skills.map((s) => ({
          id: s.manifest.id,
          name: s.manifest.name,
          version: s.manifest.version,
          description: s.manifest.description,
          author_name: s.manifest.author.name,
          published_at: s.manifest.published_at,
          tags: s.manifest.tags,
          tool_count: s.manifest.tools.length,
          installed_at: s.installed_at,
        }));
        callback(null, { skills: summaries });
      } catch (err) {
        process.stderr.write(`[skills-grpc] ListSkills error: ${String(err)}\n`);
        callback(null, { skills: [] });
      }
    },

    GetSkill(
      call: UnaryCall<GrpcGetSkillRequest, GrpcGetSkillResponse>,
      callback: Callback<GrpcGetSkillResponse>
    ): void {
      try {
        const skill = registry.get(
          call.request.skill_id,
          call.request.version || undefined
        );
        if (!skill) {
          callback(null, { found: false, manifest_json: "", installed_at: "" });
          return;
        }
        callback(null, {
          found: true,
          manifest_json: JSON.stringify(skill.manifest),
          installed_at: skill.installed_at,
        });
      } catch (err) {
        process.stderr.write(`[skills-grpc] GetSkill error: ${String(err)}\n`);
        callback(null, { found: false, manifest_json: "", installed_at: "" });
      }
    },

    RemoveSkill(
      call: UnaryCall<GrpcRemoveSkillRequest, GrpcRemoveSkillResponse>,
      callback: Callback<GrpcRemoveSkillResponse>
    ): void {
      try {
        const result = registry.remove(
          call.request.skill_id,
          call.request.version || undefined
        );
        callback(null, {
          success: result.success,
          message: result.message,
          versions_removed: result.versions_removed,
        });
      } catch (err) {
        callback(null, {
          success: false,
          message: `Unexpected error: ${String(err)}`,
          versions_removed: 0,
        });
      }
    },

    ExecuteSkillTool(
      call: UnaryCall<GrpcExecuteSkillToolRequest, GrpcExecuteSkillToolResponse>,
      callback: Callback<GrpcExecuteSkillToolResponse>
    ): void {
      const req = call.request;
      const entry = registry.getTool(req.skill_id, req.skill_version, req.tool_id);

      if (!entry) {
        callback(null, {
          call_id: req.call_id,
          success: false,
          stdout: "",
          stderr: `Tool "${req.tool_id}" not found in skill "${req.skill_id}@${req.skill_version}"`,
          exit_code: -1,
          duration_ms: 0,
          timed_out: false,
          oom_killed: false,
        });
        return;
      }

      const { tool } = entry;
      const image = `${tool.image.repository}:${tool.image.tag}@${tool.image.digest}`;

      sandbox
        .runTool({
          call_id: req.call_id,
          tool_id: req.tool_id,
          image,
          input_json: req.input_json,
          timeout_seconds: tool.resource_limits.timeout_seconds,
          memory_bytes: tool.resource_limits.memory_bytes,
          pids_limit: tool.resource_limits.pids_limit,
          network_mode: tool.resource_limits.network,
          allowed_domains: [],
          env_vars: [],
        })
        .then((result) => {
          callback(null, {
            call_id: req.call_id,
            success: result.exit_code === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exit_code,
            duration_ms: result.duration_ms,
            timed_out: result.timed_out,
            oom_killed: result.oom_killed,
          });
        })
        .catch((err: unknown) => {
          callback(null, {
            call_id: req.call_id,
            success: false,
            stdout: "",
            stderr: String(err),
            exit_code: -1,
            duration_ms: 0,
            timed_out: false,
            oom_killed: false,
          });
        });
    },
  };
}
