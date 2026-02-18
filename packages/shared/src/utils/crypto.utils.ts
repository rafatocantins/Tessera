import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from "node:crypto";

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

// ── Ed25519 — skill manifest signing ──────────────────────────────────────
//
// Keys are returned as hex-encoded DER:
//   private key → PKCS8 DER (standard, importable by OpenSSL / any tooling)
//   public  key → SPKI  DER (standard, embeddable in skill manifests)
//
// Data is always treated as UTF-8 when passed as a string.
// Ed25519 signs the raw message — no pre-hash (algorithm = null).

export interface Ed25519KeyPair {
  /** Hex-encoded SPKI DER — embed in skill manifest `public_key` field */
  publicKey: string;
  /** Hex-encoded PKCS8 DER — keep secret; used only at bundle-signing time */
  privateKey: string;
}

/**
 * Generate an Ed25519 key pair for signing skill manifests.
 * Run once per author / publisher identity; store the private key securely.
 */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: (publicKey as Buffer).toString("hex"),
    privateKey: (privateKey as Buffer).toString("hex"),
  };
}

/**
 * Sign data with an Ed25519 private key.
 * Used by the CLI `secureclaw skill sign` command when bundling a skill.
 *
 * @param privateKeyHex  Hex-encoded PKCS8 DER private key from generateEd25519KeyPair()
 * @param data           Data to sign — the canonical JSON of the skill manifest
 * @returns              Hex-encoded 64-byte Ed25519 signature
 */
export function signEd25519(privateKeyHex: string, data: string | Buffer): string {
  const keyBuf = Buffer.from(privateKeyHex, "hex");
  const privateKey = createPrivateKey({ key: keyBuf, format: "der", type: "pkcs8" });
  const dataBuf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  // algorithm = null → Ed25519 (signs raw bytes, no digest)
  return sign(null, dataBuf, privateKey).toString("hex");
}

/**
 * Verify an Ed25519 signature.
 * Used by the skills engine verifier when installing or loading a skill.
 *
 * Returns false for ANY failure: bad key format, bad hex, signature mismatch,
 * tampered data. Never throws.
 *
 * @param publicKeyHex   Hex-encoded SPKI DER public key from the skill manifest
 * @param data           The same data that was signed (canonical manifest JSON)
 * @param signatureHex   Hex-encoded signature from the manifest `signature` field
 */
export function verifyEd25519(
  publicKeyHex: string,
  data: string | Buffer,
  signatureHex: string
): boolean {
  try {
    const keyBuf = Buffer.from(publicKeyHex, "hex");
    const publicKey = createPublicKey({ key: keyBuf, format: "der", type: "spki" });
    const dataBuf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
    const signature = Buffer.from(signatureHex, "hex");
    // Ed25519 signatures are always 64 bytes; reject anything else immediately
    if (signature.length !== 64) return false;
    return verify(null, dataBuf, publicKey, signature);
  } catch {
    return false;
  }
}
