/**
 * token.ts — Generate a valid gateway HMAC bearer token for integration tests.
 *
 * Matches the token format in packages/gateway/src/plugins/auth.plugin.ts:
 *   token = {userId}.{timestamp_ms}.{hmac_sha256_hex(secret, userId:timestamp)}
 *
 * Intentionally does NOT import from @secureclaw packages — the integration package
 * is standalone to avoid circular workspace dependencies.
 */
import { createHmac } from "node:crypto";

export function generateToken(userId: string, secret: string): string {
  const ts = Date.now().toString();
  const sig = createHmac("sha256", secret).update(`${userId}:${ts}`).digest("hex");
  return `${userId}.${ts}.${sig}`;
}
