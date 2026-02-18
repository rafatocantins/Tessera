/**
 * provider.interface.ts — Unified LLM provider interface.
 *
 * All LLM providers implement this interface, enabling seamless failover,
 * provider switching per session, and the classifier/agent model split.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string | undefined;
  tool_name?: string | undefined;
  /** For assistant messages that invoked tools — used by providers to reconstruct native wire format */
  tool_calls?: Array<{ call_id: string; tool_id: string; input: Record<string, unknown> }> | undefined;
}

export interface LLMTool {
  id: string;
  description: string;
  /** JSON Schema for the tool's input parameters */
  input_schema: Record<string, unknown>;
}

export interface ToolCallData {
  call_id: string;
  tool_id: string;
  input: Record<string, unknown>;
}

export type LLMStreamChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool_call: ToolCallData }
  | {
      type: "finish";
      finish_reason: "end_turn" | "tool_use" | "max_tokens" | "stop";
      usage: { input_tokens: number; output_tokens: number };
    }
  | { type: "error"; error: string };

export interface LLMCompletionOptions {
  max_tokens?: number | undefined;
  temperature?: number | undefined;
}

export interface LLMProvider {
  readonly provider_name: string;
  readonly model_name: string;

  /**
   * Stream a completion from the LLM.
   * Yields chunks as they arrive.
   */
  streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options?: LLMCompletionOptions
  ): AsyncIterable<LLMStreamChunk>;

  /**
   * Simple non-streaming completion (used by the injection classifier).
   */
  complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number
  ): Promise<string>;

  /**
   * Estimate the cost in USD for the given token counts.
   */
  estimateCostUsd(inputTokens: number, outputTokens: number): number;
}
