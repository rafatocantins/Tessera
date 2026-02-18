/**
 * skills.client.ts — gRPC client for the SkillsService.
 *
 * Used by AgentLoop to discover dynamically installed skill tools and
 * delegate execution to the skills-engine (which in turn calls sandbox-runtime).
 */
import { loadProto, grpc, clientCredentials } from "@secureclaw/shared";
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

export type { GrpcSkillSummary };

export interface SkillToolExecParams {
  skill_id: string;
  skill_version: string;
  tool_id: string;
  input_json: string;
  call_id: string;
  session_id: string;
}

export class SkillsGrpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(addr?: string) {
    const target = addr ?? process.env["SKILLS_ADDR"] ?? "127.0.0.1:19005";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = loadProto("skills.proto") as any;
    const SkillsServiceClient = proto.secureclaw?.skills?.v1?.SkillsService as grpc.ServiceClientConstructor;
    if (!SkillsServiceClient) {
      throw new Error("Failed to load SkillsService from skills.proto");
    }
    this.client = new SkillsServiceClient(target, clientCredentials("agent-runtime"));
  }

  installSkill(manifestJson: string, force = false): Promise<GrpcInstallSkillResponse> {
    return new Promise((resolve, reject) => {
      const req: GrpcInstallSkillRequest = { manifest_json: manifestJson, force };
      this.client.InstallSkill(req, (err: grpc.ServiceError | null, res: GrpcInstallSkillResponse) => {
        if (err) { reject(err); return; }
        resolve(res);
      });
    });
  }

  listSkills(namespaceFilter = "", tagFilter = ""): Promise<GrpcSkillSummary[]> {
    return new Promise((resolve, reject) => {
      const req: GrpcListSkillsRequest = { namespace_filter: namespaceFilter, tag_filter: tagFilter };
      this.client.ListSkills(req, (err: grpc.ServiceError | null, res: GrpcListSkillsResponse) => {
        if (err) { reject(err); return; }
        resolve(res.skills ?? []);
      });
    });
  }

  getSkill(skillId: string, version = ""): Promise<GrpcGetSkillResponse> {
    return new Promise((resolve, reject) => {
      const req: GrpcGetSkillRequest = { skill_id: skillId, version };
      this.client.GetSkill(req, (err: grpc.ServiceError | null, res: GrpcGetSkillResponse) => {
        if (err) { reject(err); return; }
        resolve(res);
      });
    });
  }

  removeSkill(skillId: string, version = ""): Promise<GrpcRemoveSkillResponse> {
    return new Promise((resolve, reject) => {
      const req: GrpcRemoveSkillRequest = { skill_id: skillId, version };
      this.client.RemoveSkill(req, (err: grpc.ServiceError | null, res: GrpcRemoveSkillResponse) => {
        if (err) { reject(err); return; }
        resolve(res);
      });
    });
  }

  executeSkillTool(params: SkillToolExecParams): Promise<GrpcExecuteSkillToolResponse> {
    return new Promise((resolve, reject) => {
      const req: GrpcExecuteSkillToolRequest = {
        skill_id: params.skill_id,
        skill_version: params.skill_version,
        tool_id: params.tool_id,
        input_json: params.input_json,
        call_id: params.call_id,
        session_id: params.session_id,
      };
      this.client.ExecuteSkillTool(req, (err: grpc.ServiceError | null, res: GrpcExecuteSkillToolResponse) => {
        if (err) { reject(err); return; }
        resolve(res);
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
