/**
 * sandbox.client.ts — gRPC client for the SandboxService.
 *
 * Used by AgentLoop to execute tools in isolated gVisor containers.
 */
import { loadProto, grpc, clientCredentials } from "@secureclaw/shared";
import type {
  GrpcRunToolRequest,
  GrpcRunToolResponse,
  GrpcCheckRuntimeResponse,
} from "@secureclaw/shared";

export interface RunToolParams {
  call_id: string;
  tool_id: string;
  image: string;
  input_json: string;
  timeout_seconds?: number | undefined;
  memory_bytes?: number | undefined;
  cpu_shares?: number | undefined;
  pids_limit?: number | undefined;
  env_vars?: string[] | undefined;
  network_mode?: string | undefined;
  allowed_domains?: string[] | undefined;
}

export interface RunToolResult {
  container_id: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
  oom_killed: boolean;
}

export class SandboxGrpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(addr?: string) {
    const target = addr ?? process.env["SANDBOX_ADDR"] ?? "127.0.0.1:19004";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = loadProto("sandbox.proto") as any;
    const SandboxServiceClient = proto.secureclaw?.sandbox?.v1?.SandboxService as grpc.ServiceClientConstructor;
    if (!SandboxServiceClient) {
      throw new Error("Failed to load SandboxService from sandbox.proto");
    }
    this.client = new SandboxServiceClient(target, clientCredentials("agent-runtime"));
  }

  runTool(params: RunToolParams): Promise<RunToolResult> {
    return new Promise((resolve, reject) => {
      const req: GrpcRunToolRequest = {
        call_id: params.call_id,
        tool_id: params.tool_id,
        image: params.image,
        input_json: params.input_json,
        timeout_seconds: params.timeout_seconds ?? 60,
        limits: {
          memory_bytes: params.memory_bytes ?? 256 * 1024 * 1024,
          cpu_shares: params.cpu_shares ?? 0.5,
          pids_limit: params.pids_limit ?? 64,
        },
        env_vars: params.env_vars ?? [],
        network_mode: params.network_mode ?? "none",
        allowed_domains: params.allowed_domains ?? [],
      };
      this.client.RunTool(req, (err: grpc.ServiceError | null, res: GrpcRunToolResponse) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    });
  }

  checkRuntime(): Promise<GrpcCheckRuntimeResponse> {
    return new Promise((resolve, reject) => {
      this.client.CheckRuntime({}, (err: grpc.ServiceError | null, res: GrpcCheckRuntimeResponse) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
