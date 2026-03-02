/**
 * openai.provider.ts — OpenAI provider implementation.
 */
import OpenAI from "openai";
import { estimateCostUsd, generateCallId } from "@tessera/shared";
import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMStreamChunk,
  LLMCompletionOptions,
} from "./provider.interface.js";

export class OpenAIProvider implements LLMProvider {
  readonly provider_name = "openai";
  private client: OpenAI;

  constructor(
    readonly model_name: string,
    apiKey: string,
    baseUrl?: string
  ) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  async *streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: LLMCompletionOptions = {}
  ): AsyncIterable<LLMStreamChunk> {
    const openAIMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.filter((m) => m.role !== "system").map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool" as const,
            content: m.content,
            tool_call_id: m.tool_call_id ?? "",
          };
        }
        // Assistant message that used tools → include tool_calls array
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: "assistant" as const,
            content: m.content || null,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.call_id,
              type: "function" as const,
              function: { name: tc.tool_id, arguments: JSON.stringify(tc.input) },
            })),
          };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
        };
      }),
    ];

    const openAITools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.id,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model_name,
      messages: openAIMessages,
      ...(openAITools.length > 0 ? { tools: openAITools } : {}),
      max_tokens: options.max_tokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
    });

    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      if (delta.content) {
        yield { type: "text", text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index;
          if (!pendingToolCalls.has(idx)) {
            pendingToolCalls.set(idx, {
              id: tcDelta.id ?? generateCallId(),
              name: tcDelta.function?.name ?? "",
              args: "",
            });
          }
          const pending = pendingToolCalls.get(idx)!;
          if (tcDelta.function?.name) pending.name = tcDelta.function.name;
          if (tcDelta.function?.arguments) pending.args += tcDelta.function.arguments;
        }
      }

      if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
        // Emit all pending tool calls
        for (const [, tc] of pendingToolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.args) as Record<string, unknown>;
          } catch {
            // Malformed args
          }
          yield {
            type: "tool_call",
            tool_call: { call_id: tc.id, tool_id: tc.name, input },
          };
        }
        pendingToolCalls.clear();
      }

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }

      if (choice.finish_reason) {
        yield {
          type: "finish",
          finish_reason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
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
    const response = await this.client.chat.completions.create({
      model: this.model_name,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
    });

    return response.choices[0]?.message.content ?? "";
  }

  estimateCostUsd(inputTokens: number, outputTokens: number): number {
    return estimateCostUsd(this.model_name, inputTokens, outputTokens);
  }
}
