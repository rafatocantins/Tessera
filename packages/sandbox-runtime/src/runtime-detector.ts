/**
 * runtime-detector.ts — Detect and validate gVisor availability.
 *
 * SECURITY: gVisor (runsc) is REQUIRED by default.
 * If gVisor is not available, the sandbox-runtime refuses to start unless
 * TESSERA_ALLOW_RUNC=true is explicitly set (development escape hatch ONLY).
 *
 * gVisor provides kernel-level isolation — each container gets its own
 * sandboxed kernel, preventing container escape vulnerabilities.
 */
import Docker from "dockerode";
import { SandboxError } from "@tessera/shared";

export interface RuntimeInfo {
  gvisor_available: boolean;
  runtime_name: string; // "runsc" | "runc-dev-only"
  docker_version: string;
  ready: boolean;
  error_message?: string | undefined;
}

/**
 * Detect the available container runtime.
 *
 * @throws {SandboxError} if gVisor is unavailable and TESSERA_ALLOW_RUNC is not set
 */
export async function detectRuntime(): Promise<RuntimeInfo> {
  const docker = new Docker();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dockerInfo: Record<string, any>;
  try {
    dockerInfo = await docker.info() as Record<string, unknown>;
  } catch (err) {
    throw new SandboxError(
      `Cannot connect to Docker daemon: ${err instanceof Error ? err.message : String(err)}. ` +
      "Ensure Docker is running and the current user has access to the Docker socket.",
      { error: String(err) }
    );
  }

  const runtimes = (dockerInfo["Runtimes"] as Record<string, unknown> | undefined) ?? {};
  const gvisorAvailable = "runsc" in runtimes;
  const dockerVersion = (dockerInfo["ServerVersion"] as string | undefined) ?? "unknown";
  const allowRunc = process.env["TESSERA_ALLOW_RUNC"] === "true";

  if (!gvisorAvailable && !allowRunc) {
    throw new SandboxError(
      "gVisor (runsc) is not available as a Docker runtime. " +
      "Tessera requires gVisor for secure tool execution. " +
      "Install gVisor: https://gvisor.dev/docs/user_guide/install/ " +
      "For development only: set TESSERA_ALLOW_RUNC=true to use runc (INSECURE — NOT for production).",
      { docker_version: dockerVersion }
    );
  }

  if (!gvisorAvailable && allowRunc) {
    process.stderr.write(
      "[sandbox] WARNING: gVisor not available. Using runc runtime. " +
      "THIS IS INSECURE AND MUST NOT BE USED IN PRODUCTION.\n"
    );
  }

  return {
    gvisor_available: gvisorAvailable,
    runtime_name: gvisorAvailable ? "runsc" : "runc-dev-only",
    docker_version: dockerVersion,
    ready: true,
  };
}
