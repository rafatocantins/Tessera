/**
 * sandbox.service.ts — Core sandbox service implementation.
 *
 * Implements the SandboxService gRPC interface.
 * Coordinates runtime detection and container management.
 */
import { detectRuntime, type RuntimeInfo } from "./runtime-detector.js";
import { ContainerManager, type ToolRunResult } from "./container-manager.js";
import type { ContainerBuildConfig } from "./container-config.js";

export interface RunToolParams {
  call_id: string;
  tool_id: string;
  image: string;
  input_json: string;
  timeout_seconds: number;
  memory_bytes: number;
  cpu_shares: number;
  pids_limit: number;
  env_vars: string[];
  network_mode: "none" | "restricted" | "host_dev_only";
  allowed_domains?: string[] | undefined;
  workspace_volume?: string | undefined;
}

export class SandboxService {
  private manager: ContainerManager;
  private runtimeInfo: RuntimeInfo | null = null;

  constructor() {
    this.manager = new ContainerManager();
  }

  async initialize(): Promise<RuntimeInfo> {
    this.runtimeInfo = await detectRuntime();
    return this.runtimeInfo;
  }

  async checkRuntime(): Promise<RuntimeInfo> {
    if (this.runtimeInfo) return this.runtimeInfo;
    return this.initialize();
  }

  async runTool(params: RunToolParams): Promise<ToolRunResult> {
    if (!this.runtimeInfo) {
      await this.initialize();
    }

    const cfg: ContainerBuildConfig = {
      image: params.image,
      callId: params.call_id,
      inputJson: params.input_json,
      timeoutSeconds: Math.min(params.timeout_seconds, 300), // Hard max 5 minutes
      memoryBytes: Math.min(params.memory_bytes, 512 * 1024 * 1024), // Hard max 512 MB
      cpuShares: Math.min(params.cpu_shares, 2.0), // Hard max 2 CPUs
      pidsLimit: Math.min(params.pids_limit, 256), // Hard max 256 PIDs
      envVars: params.env_vars,
      networkMode: params.network_mode,
      allowedDomains: params.allowed_domains,
      useGvisor: this.runtimeInfo?.gvisor_available ?? false,
      workspaceVolume: params.workspace_volume,
    };

    return this.manager.runTool(cfg);
  }

  async stopContainer(containerId: string, timeoutSeconds?: number): Promise<boolean> {
    return this.manager.stopContainer(containerId, timeoutSeconds);
  }
}
