/**
 * session.ts — `tessera session` subcommands.
 *
 * create  — POST /api/v1/sessions        → prints session_id
 * status  — GET  /api/v1/sessions/:id    → prints status JSON
 * delete  — DELETE /api/v1/sessions/:id  → prints termination result
 */
import { Command } from "commander";
import { apiGet, apiPost, apiDelete, printApiError } from "../http.js";

const DEFAULT_URL = "http://127.0.0.1:18789";

/** Shared options added to every session subcommand. */
function addCommonOpts(cmd: Command): Command {
  return cmd
    .option(
      "-t, --token <bearer>",
      "Bearer token (defaults to $GATEWAY_TOKEN)"
    )
    .option(
      "--url <baseUrl>",
      `Gateway base URL (defaults to $GATEWAY_URL or ${DEFAULT_URL})`,
      process.env["GATEWAY_URL"] ?? DEFAULT_URL
    );
}

function resolveToken(opts: { token?: string }): string {
  const token = opts.token ?? process.env["GATEWAY_TOKEN"];
  if (!token) {
    process.stderr.write(
      "error: bearer token required — pass --token or set GATEWAY_TOKEN\n" +
      "       generate one with: tessera token generate --user <id> --secret <secret>\n"
    );
    process.exit(1);
  }
  return token;
}

export function sessionCommand(): Command {
  const cmd = new Command("session").description("Manage agent sessions");

  // ── session create ──────────────────────────────────────────────────────
  addCommonOpts(
    cmd
      .command("create")
      .description("Create a new agent session")
      .option("-p, --provider <provider>", "LLM provider to use", "anthropic")
      .option("--user <userId>", "User ID (defaults to 'dev-user')", "dev-user")
  ).action(
    async (opts: { token?: string; url: string; provider: string; user: string }) => {
      const token = resolveToken(opts);
      try {
        const { body } = await apiPost(
          `${opts.url}/api/v1/sessions`,
          token,
          { user_id: opts.user, provider: opts.provider }
        );
        const result = body as { session_id: string; status: string };
        process.stdout.write(`session_id: ${result.session_id}\n`);
        process.stdout.write(`status:     ${result.status}\n`);
        process.stdout.write("\nStart chatting:\n");
        process.stdout.write(
          `  open packages/channels/webchat/src/static/client.html\n`
        );
      } catch (err) {
        printApiError(err);
        process.exit(1);
      }
    }
  );

  // ── session status ──────────────────────────────────────────────────────
  addCommonOpts(
    cmd
      .command("status <sessionId>")
      .description("Get the status of a session")
  ).action(async (sessionId: string, opts: { token?: string; url: string }) => {
    const token = resolveToken(opts);
    try {
      const result = await apiGet(
        `${opts.url}/api/v1/sessions/${sessionId}`,
        token
      );
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } catch (err) {
      printApiError(err);
      process.exit(1);
    }
  });

  // ── session delete ──────────────────────────────────────────────────────
  addCommonOpts(
    cmd
      .command("delete <sessionId>")
      .description("Terminate a session")
  ).action(async (sessionId: string, opts: { token?: string; url: string }) => {
    const token = resolveToken(opts);
    try {
      const result = await apiDelete(
        `${opts.url}/api/v1/sessions/${sessionId}`,
        token
      );
      const r = result as { session_id: string; terminated: boolean; total_cost_usd: number };
      process.stdout.write(`terminated: ${r.terminated}\n`);
      process.stdout.write(`cost:       $${r.total_cost_usd.toFixed(4)}\n`);
    } catch (err) {
      printApiError(err);
      process.exit(1);
    }
  });

  return cmd;
}
