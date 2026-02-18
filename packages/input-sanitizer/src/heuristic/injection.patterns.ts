/**
 * injection.patterns.ts — Regex pattern library for heuristic injection detection.
 *
 * These patterns catch the most common prompt injection techniques.
 * They are the first (fast, synchronous) layer of defense before the
 * LLM classifier (slower, async) is called for external content.
 */

export interface InjectionPattern {
  id: string;
  description: string;
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  // === CRITICAL: Clear jailbreak / override attempts ===
  {
    id: "IGNORE_INSTRUCTIONS",
    description: "Classic 'ignore previous instructions' pattern",
    pattern: /ignore\s+(previous|all|above|prior|the\s+above)\s+(instructions?|rules?|prompts?|constraints?|guidelines?|system)/i,
    severity: "critical",
  },
  {
    id: "NEW_INSTRUCTIONS",
    description: "Attempt to inject new instructions claiming to override old ones",
    pattern: /new\s+instructions?[:;]\s*|updated?\s+instructions?[:;]\s*/i,
    severity: "critical",
  },
  {
    id: "SYSTEM_OVERRIDE",
    description: "Fake system/admin override tokens",
    pattern: /\[SYSTEM\s*\]|\[ADMIN\s*\]|\[OVERRIDE\s*\]|\[INST\s*\]|<\|system\|>|<\|assistant\|>|<\|im_start\|>|<\|im_end\|>/i,
    severity: "critical",
  },
  {
    id: "ROLE_HIJACK",
    description: "Attempt to change the agent's identity or role",
    pattern: /you\s+are\s+now\s+(a\s+)?(?!an?\s+assistant)|pretend\s+(you\s+are|to\s+be)\s+|act\s+as\s+(if\s+you\s+are\s+)?(?!a\s+helpful)|forget\s+you\s+are/i,
    severity: "critical",
  },
  {
    id: "DEVELOPER_MODE",
    description: "Fake developer/debug mode activation",
    pattern: /developer\s+mode|debug\s+mode|unrestricted\s+mode|god\s+mode|admin\s+mode|maintenance\s+mode/i,
    severity: "critical",
  },
  {
    id: "DAN_JAILBREAK",
    description: "DAN and similar jailbreak patterns",
    pattern: /\bDAN\b|do\s+anything\s+now|jailbreak|without\s+(any\s+)?restrictions?|bypass\s+(the\s+)?(safety|filters?|guardrails?)/i,
    severity: "critical",
  },

  // === HIGH: Token manipulation ===
  {
    id: "SPECIAL_TOKENS",
    description: "Injection of model-specific special tokens",
    pattern: /<\|endoftext\|>|<\|fim_prefix\|>|<\|fim_middle\|>|<\|fim_suffix\|>|\[INST\]|\[\/INST\]|<s>|<\/s>/,
    severity: "high",
  },
  {
    id: "HIDDEN_UNICODE",
    description: "Zero-width and invisible Unicode characters used to hide instructions",
    pattern: /\u200b|\u200c|\u200d|\u200e|\u200f|\ufeff|\u2060|\u2062|\u2063/,
    severity: "high",
  },
  {
    id: "REVEAL_SYSTEM_PROMPT",
    description: "Attempt to extract the system prompt",
    pattern: /repeat\s+(your\s+)?(system\s+prompt|instructions?)|print\s+(your\s+)?(system\s+prompt|full\s+instructions?)|show\s+(me\s+)?(your\s+)?(system\s+prompt|initial\s+prompt)/i,
    severity: "high",
  },
  {
    id: "DISABLE_SAFETY",
    description: "Attempt to disable safety features",
    pattern: /disable\s+(logging|audit|sandbox|approval|safety|restrictions?|guardrails?)|turn\s+off\s+(logging|safety|restrictions?)/i,
    severity: "high",
  },

  // === MEDIUM: Potentially malicious operations ===
  {
    id: "SENSITIVE_PATH_ACCESS",
    description: "Attempt to access sensitive files or paths",
    pattern: /~\/\.ssh\/|~\/\.aws\/|~\/\.config\/|\/etc\/passwd|\/etc\/shadow|\.env\b|credentials\.(json|yaml|yml)/i,
    severity: "medium",
  },
  {
    id: "EXFIL_WEBHOOK",
    description: "Suspicious external URL for potential data exfiltration",
    pattern: /webhook\.site|requestbin|pipedream\.net|beeceptor\.com|hookbin\.com|ngrok\.io/i,
    severity: "medium",
  },
  {
    id: "URGENCY_INJECTION",
    description: "Artificial urgency often used in social engineering",
    pattern: /execute\s+immediately|without\s+asking|no\s+questions|without\s+(any\s+)?confirmation|skip\s+(the\s+)?approval/i,
    severity: "medium",
  },

  // === LOW: Suspicious but ambiguous ===
  {
    id: "HTML_COMMENT_INSTRUCTIONS",
    description: "HTML comments that might hide instructions",
    pattern: /<!--[\s\S]*?(?:ignore|system|admin|override|instruction)[\s\S]*?-->/i,
    severity: "low",
  },
  {
    id: "LARGE_BASE64",
    description: "Large base64 block that might encode instructions",
    pattern: /[A-Za-z0-9+/]{100,}={0,2}/,
    severity: "low",
  },
];
