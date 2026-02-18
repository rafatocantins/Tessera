/**
 * injection.detector.ts — Heuristic injection scanner.
 *
 * Synchronous, fast, runs on every input (both user and external).
 * Returns a list of matches for logging and alerting.
 */
import { INJECTION_PATTERNS } from "./injection.patterns.js";

export interface InjectionMatch {
  pattern_id: string;
  severity: "low" | "medium" | "high" | "critical";
  excerpt: string; // First 200 chars of the suspicious match
}

export interface InjectionScanResult {
  is_suspicious: boolean;
  highest_severity: "low" | "medium" | "high" | "critical" | null;
  matches: InjectionMatch[];
}

const SEVERITY_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Scan content for prompt injection patterns.
 *
 * @param content - The text to scan
 * @returns Scan result with all matches and overall severity
 */
export function scanForInjection(content: string): InjectionScanResult {
  const matches: InjectionMatch[] = [];

  for (const { id, pattern, severity } of INJECTION_PATTERNS) {
    // Reset lastIndex for global patterns
    const clonedPattern = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    const match = clonedPattern.exec(content);

    if (match) {
      const excerpt = content.slice(
        Math.max(0, match.index - 20),
        Math.min(content.length, match.index + match[0].length + 20)
      ).slice(0, 200);

      matches.push({ pattern_id: id, severity, excerpt });
    }
  }

  if (matches.length === 0) {
    return { is_suspicious: false, highest_severity: null, matches: [] };
  }

  const highest_severity = matches.reduce<"low" | "medium" | "high" | "critical">(
    (highest, m) => {
      const currentOrder = SEVERITY_ORDER[m.severity] ?? 0;
      const highestOrder = SEVERITY_ORDER[highest] ?? 0;
      return currentOrder > highestOrder ? m.severity : highest;
    },
    "low"
  );

  return {
    is_suspicious: true,
    highest_severity,
    matches,
  };
}
