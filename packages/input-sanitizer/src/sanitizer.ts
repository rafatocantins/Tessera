/**
 * sanitizer.ts — Main SanitizerService orchestrating all input/output sanitization.
 *
 * This is the primary entry point for all content that passes through
 * the agent. It coordinates:
 * 1. Heuristic injection detection (sync, fast, runs on everything)
 * 2. Session delimiter checking (sync, fast, runs on external content)
 * 3. LLM classifier (async, runs only on external content)
 * 4. PII detection (sync, runs on outputs before destructive tools)
 * 5. Output guardrails (sync, runs before destructive tool execution)
 */
import { InjectionDetectedError } from "@tessera/shared";
import { scanForInjection, type InjectionScanResult } from "./heuristic/injection.detector.js";
import { detectAndRedactPii, type PiiDetectionResult } from "./heuristic/pii.detector.js";
import {
  createSessionDelimiters,
  wrapExternalContent,
  containsDelimiter,
  type SessionDelimiters,
} from "./delimiter/session-delimiter.js";
import {
  tagUserInstruction,
  tagExternalData,
  formatTaggedContent,
  type TaggedContent,
} from "./content-type/content-tagger.js";
import {
  classifyExternalContent,
  type LLMClassifierAdapter,
  type ClassificationResult,
} from "./llm/llm-classifier.js";
import {
  checkOutputGuardrails,
  type GuardrailResult,
} from "./output/output-guardrail.js";
import { checkUrlSafety, type UrlSafetyResult } from "./url/url-safety.js";

export interface SanitizeUserInputResult {
  safe_content: string;
  injection_scan: InjectionScanResult;
  was_blocked: boolean;
  block_reason?: string;
}

export interface SanitizeExternalContentResult {
  wrapped_content: string;
  injection_scan: InjectionScanResult;
  llm_classification?: ClassificationResult | undefined;
  is_suspicious: boolean;
  suspicion_reason?: string | undefined;
}

export interface SanitizerConfig {
  mode: "heuristic" | "llm" | "both";
  llm_threshold: number; // 0.7 default: flag if injection_confidence >= threshold
  block_on_critical: boolean; // Block (vs warn) on critical heuristic matches
}

const DEFAULT_CONFIG: SanitizerConfig = {
  mode: "both",
  llm_threshold: 0.7,
  block_on_critical: true,
};

export class SanitizerService {
  private config: SanitizerConfig;
  private sessionDelimiters: Map<string, SessionDelimiters>;
  private llmClassifier?: LLMClassifierAdapter | undefined;

  constructor(config: Partial<SanitizerConfig> = {}, llmClassifier?: LLMClassifierAdapter) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionDelimiters = new Map();
    this.llmClassifier = llmClassifier;
  }

  /**
   * Create session delimiters for a new session.
   * Must be called when a session is created.
   */
  initSession(sessionId: string): SessionDelimiters {
    const delimiters = createSessionDelimiters(sessionId);
    this.sessionDelimiters.set(sessionId, delimiters);
    return delimiters;
  }

  /**
   * Clean up session state when session ends.
   */
  destroySession(sessionId: string): void {
    this.sessionDelimiters.delete(sessionId);
  }

  /**
   * Sanitize user-provided input (from authenticated user).
   * Runs heuristic scan but does NOT block on matches (user is trusted,
   * but we still log and alert on suspicious content for visibility).
   */
  sanitizeUserInput(content: string, sessionId: string): SanitizeUserInputResult {
    const injection_scan = scanForInjection(content);

    // Check if user input contains session delimiters (would indicate an attempt
    // to inject fake DATA blocks into their own session — still worth logging)
    const delimiters = this.sessionDelimiters.get(sessionId);
    if (delimiters && containsDelimiter(content, delimiters)) {
      injection_scan.matches.push({
        pattern_id: "SESSION_DELIMITER_IN_USER_INPUT",
        severity: "high",
        excerpt: content.slice(0, 200),
      });
      injection_scan.is_suspicious = true;
    }

    // Critical matches from users are still logged as warnings but not blocked
    // (users are authenticated — we trust them more than external sources)
    const tagged: TaggedContent = tagUserInstruction(content);

    return {
      safe_content: formatTaggedContent(tagged),
      injection_scan,
      was_blocked: false,
    };
  }

  /**
   * Sanitize external content (web scraping, file reads, email body, etc.).
   * Runs both heuristic and LLM classification. Critical matches trigger alerts.
   * Content is wrapped in session-specific DATA delimiters.
   */
  async sanitizeExternalContent(
    content: string,
    sessionId: string,
    source: string
  ): Promise<SanitizeExternalContentResult> {
    const delimiters = this.sessionDelimiters.get(sessionId);
    if (!delimiters) {
      throw new Error(`No session delimiters found for session ${sessionId}. Call initSession() first.`);
    }

    // 1. Heuristic scan
    const injection_scan = scanForInjection(content);

    // 2. Check if content tries to reproduce session delimiters
    if (containsDelimiter(content, delimiters)) {
      injection_scan.is_suspicious = true;
      injection_scan.matches.push({
        pattern_id: "SESSION_DELIMITER_ESCAPE_ATTEMPT",
        severity: "critical",
        excerpt: content.slice(0, 200),
      });
    }

    // 3. LLM classification for external content (if enabled and classifier available)
    let llm_classification: ClassificationResult | undefined;
    if (
      (this.config.mode === "llm" || this.config.mode === "both") &&
      this.llmClassifier
    ) {
      llm_classification = await classifyExternalContent(
        content,
        this.llmClassifier,
        { threshold: this.config.llm_threshold }
      );
    }

    const is_suspicious =
      injection_scan.is_suspicious ||
      (llm_classification !== undefined &&
        llm_classification.injection_confidence >= this.config.llm_threshold);

    const suspicion_reason = is_suspicious
      ? injection_scan.is_suspicious
        ? `Heuristic: ${injection_scan.matches.map((m) => m.pattern_id).join(", ")}`
        : `LLM classifier confidence: ${llm_classification?.injection_confidence ?? 0}`
      : undefined;

    // 4. Wrap external content in DATA delimiters (even if suspicious — the LLM
    //    needs to see what the injection attempt was to report it to the user)
    const tagged = tagExternalData(content, source);
    const wrapped = wrapExternalContent(
      formatTaggedContent(tagged),
      delimiters,
      source
    );

    const result: SanitizeExternalContentResult = {
      wrapped_content: wrapped,
      injection_scan,
      is_suspicious,
    };
    if (llm_classification !== undefined) result.llm_classification = llm_classification;
    if (suspicion_reason !== undefined) result.suspicion_reason = suspicion_reason;
    return result;
  }

  /**
   * Check output before executing a destructive tool.
   * Returns guardrail result — callers must respect blocking violations.
   */
  checkOutputGuardrails(toolId: string, toolInputJson: string): GuardrailResult {
    return checkOutputGuardrails(toolId, toolInputJson);
  }

  /**
   * Detect and redact PII in any content string.
   */
  detectPii(content: string): PiiDetectionResult {
    return detectAndRedactPii(content);
  }

  /**
   * Check whether a URL is safe to request (SSRF prevention).
   * Validates scheme, private IP ranges, metadata endpoints, and domain lists.
   */
  checkUrlSafety(url: string): UrlSafetyResult {
    return checkUrlSafety(url);
  }

  /**
   * Quick injection check — throws InjectionDetectedError on critical matches.
   * Use for fast-path blocking of clearly malicious inputs.
   */
  assertNotInjection(content: string, context: string): void {
    const result = scanForInjection(content);
    if (
      result.is_suspicious &&
      result.highest_severity === "critical" &&
      this.config.block_on_critical
    ) {
      const match = result.matches[0];
      if (match) {
        throw new InjectionDetectedError(match.pattern_id, match.excerpt);
      }
    }
  }
}
