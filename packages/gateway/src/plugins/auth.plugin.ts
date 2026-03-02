/**
 * auth.plugin.ts — HMAC token authentication for the gateway.
 *
 * SECURITY PROPERTIES:
 * - Tokens are ONLY accepted in the Authorization header (never query params)
 * - Constant-time comparison prevents timing attacks
 * - Configurable replay window (TOKEN_EXPIRY_SECONDS, default 300) prevents token replay
 * - No "localhost trust" — authentication is always required
 *
 * Token format: {userId}.{timestamp_ms}.{hmac_sha256(secret, userId:timestamp)}
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyHmac, signHmac, isExpired, nowUtcMs } from "@tessera/shared";

void isExpired; // Used in other modules

// Gateway secret is loaded from the OS vault at startup, never from env
let gatewaySecret = "";

export function setGatewaySecret(secret: string): void {
  gatewaySecret = secret;
}

export function getGatewaySecret(): string {
  return gatewaySecret;
}

/**
 * Returns the token expiry window in milliseconds.
 * Reads TOKEN_EXPIRY_SECONDS from env (30–604800 range); defaults to 300s (5 minutes).
 */
export function getTokenExpiryMs(): number {
  const val = process.env["TOKEN_EXPIRY_SECONDS"];
  if (val) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 30 && n <= 604800) return n * 1000;
  }
  return 5 * 60 * 1000; // default: 5 minutes
}

/**
 * Generate a signed HMAC token for a user.
 * Called by the CLI to generate tokens for configured users.
 */
export function generateGatewayToken(userId: string, secret: string): string {
  const timestamp = nowUtcMs().toString();
  const payload = `${userId}:${timestamp}`;
  const signature = signHmac(secret, payload);
  return `${userId}.${timestamp}.${signature}`;
}

/**
 * Fastify pre-handler hook that validates HMAC tokens.
 * Attached to all authenticated routes.
 */
export async function verifyToken(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    await reply.code(401).send({
      error: "unauthorized",
      message: "Authorization header with Bearer token required",
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  const parts = token.split(".");

  if (parts.length !== 3) {
    await reply.code(401).send({
      error: "unauthorized",
      message: "Invalid token format",
    });
    return;
  }

  const [userId, timestampStr, signature] = parts as [string, string, string];
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    await reply.code(401).send({ error: "unauthorized", message: "Invalid token timestamp" });
    return;
  }

  // Replay attack prevention: reject tokens older than the configured expiry window
  if (Math.abs(nowUtcMs() - timestamp) > getTokenExpiryMs()) {
    await reply.code(401).send({ error: "unauthorized", message: "Token expired or from the future" });
    return;
  }

  // Constant-time HMAC verification
  const payload = `${userId}:${timestampStr}`;
  if (!verifyHmac(gatewaySecret, payload, signature)) {
    await reply.code(401).send({ error: "unauthorized", message: "Invalid token signature" });
    return;
  }

  // Attach userId to request for use in route handlers
  req.userId = userId;
}

/**
 * Hook that blocks any request with Authorization data in query parameters.
 * Tokens in URLs appear in server logs, browser history, and proxies.
 */
export async function blockTokenInQueryParams(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const query = req.query as Record<string, string>;
  const suspiciousKeys = ["token", "access_token", "auth", "api_key", "key", "authorization"];

  for (const key of suspiciousKeys) {
    if (key in query) {
      await reply.code(400).send({
        error: "bad_request",
        message: "Authentication credentials must not appear in URL query parameters. Use Authorization header.",
      });
      return;
    }
  }
}

// Augment FastifyRequest to include userId
declare module "fastify" {
  interface FastifyRequest {
    userId?: string | undefined;
  }
}
