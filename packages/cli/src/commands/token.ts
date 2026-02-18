/**
 * token.ts — `secureclaw token` subcommands.
 *
 * generate: Creates a signed HMAC bearer token for the gateway.
 *
 * Token format: {userId}.{timestamp_ms}.{hmac_sha256(secret, userId:timestamp)}
 * This mirrors the logic in packages/gateway/src/plugins/auth.plugin.ts
 */
import { Command } from "commander";
import { signHmac, nowUtcMs } from "@secureclaw/shared";

/** Replicate gateway token generation without importing the gateway package. */
function makeToken(userId: string, secret: string): string {
  const timestamp = nowUtcMs().toString();
  const payload = `${userId}:${timestamp}`;
  const signature = signHmac(secret, payload);
  return `${userId}.${timestamp}.${signature}`;
}

export function tokenCommand(): Command {
  const cmd = new Command("token").description("Manage gateway auth tokens");

  cmd
    .command("generate")
    .description("Generate a signed HMAC bearer token")
    .requiredOption("-u, --user <userId>", "User ID to embed in the token (e.g. dev-user)")
    .option(
      "-s, --secret <secret>",
      "HMAC secret (defaults to $GATEWAY_HMAC_SECRET)"
    )
    .action((opts: { user: string; secret?: string }) => {
      const secret = opts.secret ?? process.env["GATEWAY_HMAC_SECRET"];
      if (!secret) {
        process.stderr.write(
          "error: HMAC secret required — pass --secret or set GATEWAY_HMAC_SECRET\n"
        );
        process.exit(1);
      }
      const token = makeToken(opts.user, secret);
      process.stdout.write(token + "\n");
    });

  return cmd;
}
