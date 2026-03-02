/**
 * url-safety.ts — SSRF prevention for outbound HTTP requests.
 *
 * Checks (in order):
 * 1. Invalid URL — parse failure
 * 2. TLS enforcement — http: scheme blocked unless TESSERA_REQUIRE_TLS=false
 * 3. Metadata endpoints — cloud IMDS hostnames
 * 4. Private/loopback IPs — RFC 1918 + loopback + IPv6 private ranges
 * 5. Localhost names — localhost, *.local, *.internal
 * 6. HTTP_BLOCKED_DOMAINS — operator-specified blocklist
 * 7. HTTP_ALLOWED_DOMAINS — operator-specified allowlist (opt-in, empty = all pass)
 */

export type UrlSafetyCategory =
  | "invalid_url"
  | "plain_http"
  | "private_ip"
  | "metadata_endpoint"
  | "localhost"
  | "blocked_domain"
  | "not_in_allowlist";

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
  category?: UrlSafetyCategory;
}

// Cloud metadata service hostnames (strip port before comparing)
const METADATA_HOSTNAMES = new Set([
  "169.254.169.254",       // AWS IMDS / GCP / Azure link-local
  "metadata.google.internal",
  "metadata.azure.com",
]);

// Regex for private / loopback IPv4 ranges
const PRIVATE_IPV4_RE =
  /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

// Regex for private / loopback IPv6 addresses
const PRIVATE_IPV6_RE =
  /^(?:::1|fe80:[0-9a-f:]*|fd[0-9a-f]{2}:[0-9a-f:]*)/i;

/**
 * Strip brackets from IPv6 literals so `[::1]` → `::1`.
 */
function stripBrackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

/**
 * Check whether the given raw URL string is safe to request.
 * Pure function — reads only from process.env; no network calls.
 */
export function checkUrlSafety(rawUrl: string): UrlSafetyResult {
  // 1. Parse — reject clearly malformed URLs
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "URL is invalid or cannot be parsed", category: "invalid_url" };
  }

  const hostname = stripBrackets(parsed.hostname.toLowerCase());

  // 2. TLS enforcement — block plain http: unless operator opts out
  if (parsed.protocol === "http:") {
    const requireTls = process.env["TESSERA_REQUIRE_TLS"];
    if (requireTls !== "false") {
      return {
        safe: false,
        reason: "Plain HTTP is not allowed. Use HTTPS or set TESSERA_REQUIRE_TLS=false to permit.",
        category: "plain_http",
      };
    }
  }

  // 3. Metadata endpoints (check before IP range checks — 169.254.169.254 also
  //    matches the private IP range, but we want the more specific label)
  if (METADATA_HOSTNAMES.has(hostname)) {
    return {
      safe: false,
      reason: `Access to cloud metadata endpoint '${hostname}' is blocked (SSRF prevention)`,
      category: "metadata_endpoint",
    };
  }

  // 4. Private / loopback IP ranges
  if (PRIVATE_IPV4_RE.test(hostname) || PRIVATE_IPV6_RE.test(hostname)) {
    return {
      safe: false,
      reason: `Access to private or loopback address '${hostname}' is blocked (SSRF prevention)`,
      category: "private_ip",
    };
  }

  // 5. Localhost names (localhost, *.local, *.internal)
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return {
      safe: false,
      reason: `Access to local hostname '${hostname}' is blocked (SSRF prevention)`,
      category: "localhost",
    };
  }

  // 6. Operator blocklist — HTTP_BLOCKED_DOMAINS (always applied)
  const blockedDomainsEnv = process.env["HTTP_BLOCKED_DOMAINS"] ?? "";
  if (blockedDomainsEnv.trim()) {
    const blocked = blockedDomainsEnv.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (blocked.includes(hostname)) {
      return {
        safe: false,
        reason: `Domain '${hostname}' is in the HTTP_BLOCKED_DOMAINS blocklist`,
        category: "blocked_domain",
      };
    }
  }

  // 7. Operator allowlist — HTTP_ALLOWED_DOMAINS (opt-in; empty = all pass)
  const allowedDomainsEnv = process.env["HTTP_ALLOWED_DOMAINS"] ?? "";
  if (allowedDomainsEnv.trim()) {
    const allowed = allowedDomainsEnv.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(hostname)) {
      return {
        safe: false,
        reason: `Domain '${hostname}' is not in the HTTP_ALLOWED_DOMAINS allowlist`,
        category: "not_in_allowlist",
      };
    }
  }

  return { safe: true };
}
