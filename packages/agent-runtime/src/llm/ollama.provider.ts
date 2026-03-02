/**
 * ollama.provider.ts — Ollama (local models) provider implementation.
 */
import { Ollama } from "ollama";
import type { Message, Tool, ChatResponse } from "ollama";
import { generateCallId } from "@tessera/shared";
import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMStreamChunk,
  LLMCompletionOptions,
} from "./provider.interface.js";

export class OllamaProvider implements LLMProvider {
  readonly provider_name = "ollama";
  private client: Ollama;

  constructor(
    readonly model_name: string,
    baseUrl = "http://127.0.0.1:11434"
  ) {
    this.client = new Ollama({ host: baseUrl });
  }

  async *streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: LLMCompletionOptions = {}
  ): AsyncIterable<LLMStreamChunk> {
    const ollamaMessages: Message[] = [
      { role: "system", content: systemPrompt },
      ...messages.filter((m) => m.role !== "system").map((m): Message => {
        // Assistant message that used tools → include tool_calls in Ollama format
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: "assistant",
            content: m.content,
            tool_calls: m.tool_calls.map((tc) => ({
              function: { name: tc.tool_id, arguments: tc.input },
            })),
          };
        }
        return {
          role: m.role as "user" | "assistant" | "tool",
          content: m.content,
        };
      }),
    ];

    const ollamaTools: Tool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.id,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    try {
      const stream = await this.client.chat({
        model: this.model_name,
        messages: ollamaMessages,
        ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
        options: { num_predict: options.max_tokens ?? 4096 },
        stream: true,
      });

      let inputTokens = 0;
      let outputTokens = 0;
      const emittedToolCalls: string[] = [];

      for await (const chunk of stream) {
        if (chunk.message.content) {
          yield { type: "text", text: chunk.message.content };
        }

        if (chunk.message.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            const callId = generateCallId();
            if (!emittedToolCalls.includes(callId)) {
              emittedToolCalls.push(callId);
              yield {
                type: "tool_call",
                tool_call: {
                  call_id: callId,
                  tool_id: tc.function.name,
                  input: tc.function.arguments as Record<string, unknown>,
                },
              };
            }
          }
        }

        if (chunk.done) {
          inputTokens = (chunk as ChatResponse & { prompt_eval_count?: number }).prompt_eval_count ?? 0;
          outputTokens = (chunk as ChatResponse & { eval_count?: number }).eval_count ?? 0;

          yield {
            type: "finish",
            finish_reason: emittedToolCalls.length > 0 ? "tool_use" : "end_turn",
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          };
        }
      }
    } catch (err) {
      yield { type: "error", error: `Ollama error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number
  ): Promise<string> {
    const response = await this.client.chat({
      model: this.model_name,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      options: { num_predict: maxTokens },
    });

    return response.message.content;
  }

  /** Ollama is free (local) — always zero cost */
  estimateCostUsd(_inputTokens: number, _outputTokens: number): number {
    return 0;
  }
}
