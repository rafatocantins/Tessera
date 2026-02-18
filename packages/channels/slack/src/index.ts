/**
 * index.ts — Slack channel entry point.
 *
 * Validates required env vars, starts the Slack app in Socket Mode, and
 * gracefully shuts down on SIGTERM/SIGINT.
 */
import { SlackChannel } from "./app.js";

const REQUIRED_ENV = [
  "GATEWAY_URL",
  "GATEWAY_HMAC_SECRET",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
] as const;

function validateEnv(): {
  gatewayUrl: string;
  hmacSecret: string;
  botToken: string;
  appToken: string;
} {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(
      `[slack] FATAL: Missing required env vars: ${missing.join(", ")}\n`
    );
    process.exit(1);
  }

  return {
    gatewayUrl: process.env["GATEWAY_URL"]!,
    hmacSecret: process.env["GATEWAY_HMAC_SECRET"]!,
    botToken: process.env["SLACK_BOT_TOKEN"]!,
    appToken: process.env["SLACK_APP_TOKEN"]!,
  };
}

const isMain = process.argv[1]?.endsWith("index.js") ?? false;

if (isMain) {
  const { gatewayUrl, hmacSecret, botToken, appToken } = validateEnv();

  const channel = new SlackChannel(gatewayUrl, hmacSecret, botToken, appToken);

  process.once("SIGTERM", () => {
    void channel.stop().then(() => process.exit(0));
  });

  process.once("SIGINT", () => {
    void channel.stop().then(() => process.exit(0));
  });

  void channel.start();
}

export { SlackChannel } from "./app.js";
export { generateToken, createSession, openChat, terminateSession } from "./gateway-client.js";
