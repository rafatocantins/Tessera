/**
 * pii.detector.ts — PII (Personally Identifiable Information) detection.
 *
 * Used to detect PII in agent outputs before they are sent to external
 * services (network calls, webhooks, emails). Prevents accidental exfiltration.
 */

export interface PiiType {
  name: string;
  pattern: RegExp;
  maskWith: string;
}

const PII_TYPES: PiiType[] = [
  {
    name: "EMAIL",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    maskWith: "[EMAIL_REDACTED]",
  },
  {
    name: "PHONE_US",
    pattern: /\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    maskWith: "[PHONE_REDACTED]",
  },
  {
    name: "SSN",
    pattern: /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g,
    maskWith: "[SSN_REDACTED]",
  },
  {
    name: "CREDIT_CARD",
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|[25][1-7][0-9]{14}|6(?:011|5[0-9]{2})[0-9]{12}|3[47][0-9]{13})\b/g,
    maskWith: "[CC_REDACTED]",
  },
  {
    name: "API_KEY_ANTHROPIC",
    pattern: /sk-ant-api[0-9a-zA-Z\-]{20,}/g,
    maskWith: "[ANTHROPIC_KEY_REDACTED]",
  },
  {
    name: "API_KEY_OPENAI",
    pattern: /sk-[a-zA-Z0-9]{48}/g,
    maskWith: "[OPENAI_KEY_REDACTED]",
  },
  {
    name: "API_KEY_GOOGLE",
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    maskWith: "[GOOGLE_KEY_REDACTED]",
  },
  {
    name: "AWS_ACCESS_KEY",
    pattern: /AKIA[0-9A-Z]{16}/g,
    maskWith: "[AWS_KEY_REDACTED]",
  },
  {
    name: "PRIVATE_KEY_BLOCK",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    maskWith: "[PRIVATE_KEY_REDACTED]",
  },
];

export interface PiiDetectionResult {
  has_pii: boolean;
  types_found: string[];
  redacted_content: string;
}

/**
 * Scan content for PII and return both detected types and a redacted version.
 */
export function detectAndRedactPii(content: string): PiiDetectionResult {
  const types_found: string[] = [];
  let redacted_content = content;

  for (const { name, pattern, maskWith } of PII_TYPES) {
    // Clone to reset lastIndex
    const clonedPattern = new RegExp(pattern.source, pattern.flags);
    if (clonedPattern.test(content)) {
      types_found.push(name);
      // Apply redaction
      const replacePattern = new RegExp(pattern.source, pattern.flags);
      redacted_content = redacted_content.replace(replacePattern, maskWith);
    }
  }

  return {
    has_pii: types_found.length > 0,
    types_found,
    redacted_content,
  };
}
