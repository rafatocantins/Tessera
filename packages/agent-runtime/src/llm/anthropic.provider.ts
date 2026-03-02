/**
 * anthropic.provider.ts — Anthropic Claude provider implementation.
 */
import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd, generateCallId } from "@tessera/shared";
import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMStreamChunk,
  LLMCompletionOptions,
} from "./provider.interface.js";

export class AnthropicProvider implements LLMProvider {
  readonly provider_name = "anthropic";
  private client: Anthropic;

  constructor(
    readonly model_name: string,
    apiKey: string
  ) {
    // apiKey is injected at construction time — never stored in session context
    // ANTHROPIC_BASE_URL may be set to point at a local mock server (e.g. integration tests)
    this.client = new Anthropic({
      apiKey,
      ...(process.env["ANTHROPIC_BASE_URL"]
        ? { baseURL: process.env["ANTHROPIC_BASE_URL"] }
        : {}),
    });
  }

  async *streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: LLMCompletionOptions = {}
  ): AsyncIterable<LLMStreamChunk> {
    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        // Tool result → wrapped in a user message with tool_result content block
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [{ type: "tool_result" as const, tool_use_id: m.tool_call_id ?? "", content: m.content }],
          };
        }
        // Assistant message that used tools → structured content with tool_use blocks
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
          const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
          if (m.content) {
            contentBlocks.push({ type: "text", text: m.content });
          }
          for (const tc of m.tool_calls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.call_id,
              name: tc.tool_id,
              input: tc.input,
            });
          }
          return { role: "assistant" as const, content: contentBlocks };
        }
        return { role: m.role as "user" | "assistant", content: m.content };
      });

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.id,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));

    const stream = this.client.messages.stream({
      model: this.model_name,
      system: systemPrompt,
      messages: anthropicMessages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      max_tokens: options.max_tokens ?? 4096,
    });

    let currentToolUseId: string | null = null;
    let currentToolName: string | null = null;
    let currentToolInputStr = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolUseId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInputStr = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          currentToolInputStr += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolUseId && currentToolName) {
          let toolInput: Record<string, unknown> = {};
          try {
            toolInput = JSON.parse(currentToolInputStr) as Record<string, unknown>;
          } catch {
            // Malformed tool input — empty input
          }
          yield {
            type: "tool_call",
            tool_call: {
              call_id: currentToolUseId,
              tool_id: currentToolName,
              input: toolInput,
            },
          };
          currentToolUseId = null;
          currentToolName = null;
          currentToolInputStr = "";
        }
      } else if (event.type === "message_delta") {
        outputTokens = event.usage.output_tokens;
      } else if (event.type === "message_start") {
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === "message_stop") {
        const finalMsg = await stream.finalMessage();
        yield {
          type: "finish",
          finish_reason: finalMsg.stop_reason === "tool_use" ? "tool_use" : "end_turn",
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        };
      }
    }
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model_name,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: maxTokens,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  }

  estimateCostUsd(inputTokens: number, outputTokens: number): number {
    return estimateCostUsd(this.model_name, inputTokens, outputTokens);
  }
}

// Suppress unused import warning
void generateCallId;
