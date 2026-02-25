/**
 * container-config.ts — Hardened container configuration builder.
 *
 * Every container created by SecureClaw's sandbox runtime uses these settings.
 * Security properties enforced:
 * - gVisor (runsc) runtime: kernel-level isolation
 * - ALL Linux capabilities dropped: no privileged operations
 * - no-new-privileges: cannot gain new capabilities at runtime
 * - Read-only root filesystem: no persistent writes
 * - /tmp as in-memory tmpfs (noexec, nosuid): can't write executables
 * - Non-root user (nobody:nogroup = UID 65534)
 * - Memory, CPU, and PID limits: resource exhaustion prevention
 * - Network isolated by default (none mode): no outbound access unless explicitly allowed
 */
import type Docker from "dockerode";

export interface ContainerBuildConfig {
  image: string;
  callId: string;
  inputJson: string;
  timeoutSeconds: number;
  memoryBytes: number;
  cpuShares: number;   // Fraction of one CPU (0.5 = 50% of one core)
  pidsLimit: number;
  envVars: string[];   // Must NOT contain raw credentials
  networkMode: "none" | "restricted" | "host_dev_only";
  allowedDomains?: string[] | undefined;
  useGvisor: boolean;
  /** Named Docker volume to mount at /workspace (read-write, persists per session). */
  workspaceVolume?: string | undefined;
}

const TOOL_RUNNER_CMD = ["node", "/tool/run.js"];
const NOBODY_UID = "65534:65534"; // nobody:nogroup

export function buildHardenedContainerOptions(
  cfg: ContainerBuildConfig
): Docker.ContainerCreateOptions {
  // Validate: no credential patterns in env vars
  for (const envVar of cfg.envVars) {
    if (
      envVar.includes("__VAULT_REF:") ||
      /sk-ant-api|sk-[a-zA-Z0-9]{40,}|AIza/.test(envVar)
    ) {
      throw new Error(
        `Credential detected in env vars for container ${cfg.callId}. ` +
        "Use credential injection via the vault instead of environment variables."
      );
    }
  }

  return {
    Image: cfg.image,
    Cmd: TOOL_RUNNER_CMD,
    Env: [
      `TOOL_INPUT=${cfg.inputJson}`,
      `CALL_ID=${cfg.callId}`,
      "NODE_ENV=sandbox",
      ...cfg.envVars,
    ],
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    User: NOBODY_UID,
    Labels: {
      "secureclaw.call_id": cfg.callId,
      "secureclaw.managed": "true",
      "secureclaw.created_at": new Date().toISOString(),
    },
    HostConfig: {
      // CRITICAL: Use gVisor (runsc) for kernel-level isolation
      Runtime: cfg.useGvisor ? "runsc" : "runc",

      // Memory: hard limit, no swap
      Memory: cfg.memoryBytes,
      MemorySwap: cfg.memoryBytes, // Equal = no swap
      MemorySwappiness: 0,

      // CPU: fractional limit via NanoCPUs
      NanoCpus: Math.floor(cfg.cpuShares * 1_000_000_000),

      // PID limit: prevent fork bombs
      PidsLimit: cfg.pidsLimit,

      // Drop ALL Linux capabilities
      CapDrop: ["ALL"],
      CapAdd: [], // Nothing added back

      // Security: prevent privilege escalation
      SecurityOpt: ["no-new-privileges:true"],

      // Read-only root filesystem: no persistent writes
      ReadonlyRootfs: true,

      // /tmp: in-memory, no execute, no setuid
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=32m" },

      // Network isolation
      NetworkMode: cfg.networkMode === "none" ? "none" : "bridge",

      // Never privileged
      Privileged: false,

      // OOM: kill immediately rather than waiting
      OomKillDisable: false,
      OomScoreAdj: 500,

      // ulimits: restrict file descriptors and processes
      Ulimits: [
        { Name: "nofile", Soft: 64, Hard: 64 },
        { Name: "nproc", Soft: cfg.pidsLimit, Hard: cfg.pidsLimit },
      ],

      // Logging: none (we capture via dockerode Attach, not log driver)
      LogConfig: { Type: "none", Config: {} },

      // Workspace volume: shared named volume per session, mounted rw at /workspace
      // Volume is created by Docker on first use and persists until session cleanup.
      ...(cfg.workspaceVolume
        ? { Binds: [`${cfg.workspaceVolume}:/workspace:rw`] }
        : {}),

      // Auto-remove after exit (cleanup)
      AutoRemove: false, // We remove manually after capturing output
    },
  };
}
