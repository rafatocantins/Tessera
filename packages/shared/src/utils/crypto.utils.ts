import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Generates a cryptographically secure random hex token.
 * Default 32 bytes = 64 hex characters.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Signs payload with HMAC-SHA256 using the given secret.
 */
export function signHmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Constant-time HMAC verification to prevent timing attacks.
 */
export function verifyHmac(
  secret: string,
  payload: string,
  signature: string
): boolean {
  const expected = signHmac(secret, payload);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Generates a cryptographically random session delimiter.
 * Used to mark boundaries in the system prompt; injected content
 * that attempts to "escape" this delimiter can be detected.
 */
export function generateSessionDelimiter(): string {
  return `[SC-BOUNDARY:${randomBytes(16).toString("hex")}]`;
}

/**
 * Generates a short unique call ID for tool invocations.
 * Format: base36-timestamp + random hex
 */
export function generateCallId(): string {
  return `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
}

/**
 * Generates a standard UUID v4 using Node.js crypto.randomUUID.
 */
export function generateUuid(): string {
  return crypto.randomUUID();
}

// Alias for convenience
export const randomUuid = generateUuid;
