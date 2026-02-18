/**
 * session-delimiter.ts — Cryptographic session boundary management.
 *
 * Each session gets a unique random delimiter string.
 * External content (web pages, emails, files) is wrapped in this delimiter.
 * The system prompt instructs the LLM to treat everything inside as DATA only.
 *
 * Injection attempts that try to "escape" the delimiter (e.g., by
 * reproducing it) are detectable because the delimiter is unguessable.
 */
import { generateToken } from "@secureclaw/shared";

export interface SessionDelimiters {
  session_id: string;
  open_tag: string;
  close_tag: string;
}

/**
 * Create a unique set of delimiters for a session.
 * The delimiter uses a cryptographically random token to prevent guessing.
 */
export function createSessionDelimiters(sessionId: string): SessionDelimiters {
  const token = generateToken(16); // 32 hex chars
  return {
    session_id: sessionId,
    open_tag: `<<<EXTERNAL_DATA_${token.toUpperCase()}>>>`,
    close_tag: `<<<END_EXTERNAL_DATA_${token.toUpperCase()}>>>`,
  };
}

/**
 * Wrap external content in session-specific DATA delimiters.
 * The LLM is instructed in the system prompt to treat this as DATA, never INSTRUCTIONS.
 */
export function wrapExternalContent(
  content: string,
  delimiters: SessionDelimiters,
  source?: string
): string {
  const sourceAnnotation = source ? ` SOURCE="${sanitizeSource(source)}"` : "";
  return [
    `${delimiters.open_tag}${sourceAnnotation}`,
    content,
    delimiters.close_tag,
  ].join("\n");
}

/**
 * Check if content contains the session delimiter (would indicate injection attempt).
 * An attacker would need to know the random token to reproduce the delimiter.
 */
export function containsDelimiter(
  content: string,
  delimiters: SessionDelimiters
): boolean {
  return (
    content.includes(delimiters.open_tag) ||
    content.includes(delimiters.close_tag)
  );
}

/**
 * Sanitize source URL/path for use in delimiter attributes.
 * Prevents attribute injection.
 */
function sanitizeSource(source: string): string {
  return source.replace(/['"<>]/g, "").slice(0, 200);
}
