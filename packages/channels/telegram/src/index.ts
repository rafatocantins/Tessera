/**
 * index.ts — Telegram channel entry point.
 *
 * Validates required env vars, starts the Telegram bot, and gracefully
 * shuts down on SIGTERM/SIGINT.
 */
import { TelegramChannel } from "./bot.js";

const REQUIRED_ENV = [
  "GATEWAY_URL",
  "GATEWAY_HMAC_SECRET",
  "TELEGRAM_BOT_TOKEN",
] as const;

function validateEnv(): {
  gatewayUrl: string;
  hmacSecret: string;
  botToken: string;
} {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(
      `[telegram] FATAL: Missing required env vars: ${missing.join(", ")}\n`
    );
    process.exit(1);
  }

  return {
    gatewayUrl: process.env["GATEWAY_URL"]!,
    hmacSecret: process.env["GATEWAY_HMAC_SECRET"]!,
    botToken: process.env["TELEGRAM_BOT_TOKEN"]!,
  };
}

const isMain = process.argv[1]?.endsWith("index.js") ?? false;

if (isMain) {
  const { gatewayUrl, hmacSecret, botToken } = validateEnv();

  const channel = new TelegramChannel(botToken, gatewayUrl, hmacSecret);

  process.once("SIGTERM", () => {
    channel.stop("SIGTERM");
    process.exit(0);
  });

  process.once("SIGINT", () => {
    channel.stop("SIGINT");
    process.exit(0);
  });

  channel.start();
}

export { TelegramChannel } from "./bot.js";
export { generateToken, createSession, openChat, terminateSession } from "./gateway-client.js";
