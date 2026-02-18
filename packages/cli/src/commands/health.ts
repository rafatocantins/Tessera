/**
 * health.ts — `secureclaw health` — ping the gateway health endpoint.
 */
import { Command } from "commander";

const DEFAULT_URL = "http://127.0.0.1:18789";

export function healthCommand(): Command {
  return new Command("health")
    .description("Check gateway health")
    .option(
      "--url <baseUrl>",
      `Gateway base URL (defaults to $GATEWAY_URL or ${DEFAULT_URL})`,
      process.env["GATEWAY_URL"] ?? DEFAULT_URL
    )
    .action(async (opts: { url: string }) => {
      try {
        const res = await fetch(`${opts.url}/health`);
        const body = await res.json() as Record<string, unknown>;
        if (res.ok) {
          process.stdout.write(`status: ${body["status"] ?? "ok"}\n`);
        } else {
          process.stderr.write(`unhealthy: HTTP ${res.status}\n`);
          process.exit(1);
        }
      } catch (err) {
        process.stderr.write(
          `error: could not reach gateway at ${opts.url}\n` +
          `       ${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exit(1);
      }
    });
}
