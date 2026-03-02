/**
 * gemini.provider.ts — Google Gemini provider implementation.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  GenerateContentStreamResult,
  FunctionCall,
  FunctionDeclaration,
  Content,
  Part,
} from "@google/generative-ai";
import { estimateCostUsd, generateCallId } from "@tessera/shared";
import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMStreamChunk,
  LLMCompletionOptions,
} from "./provider.interface.js";

export class GeminiProvider implements LLMProvider {
  readonly provider_name = "gemini";
  private genAI: GoogleGenerativeAI;

  constructor(
    readonly model_name: string,
    apiKey: string
  ) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async *streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: LLMCompletionOptions = {}
  ): AsyncIterable<LLMStreamChunk> {
    const model = this.genAI.getGenerativeModel({
      model: this.model_name,
      systemInstruction: systemPrompt,
      ...(tools.length > 0
        ? { tools: [{ functionDeclarations: tools.map((t) => this.toGeminiFunctionDeclaration(t)) }] }
        : {}),
    });

    // Convert all messages to Gemini Content format.
    // Using generateContentStream (not the chat API) for full control over
    // multi-turn tool call history (functionCall + functionResponse parts).
    const contents: Content[] = messages
      .filter((m) => m.role !== "system")
      .map((m): Content => {
        if (m.role === "tool") {
          // Tool result → user turn with functionResponse part
          return {
            role: "user",
            parts: [{ functionResponse: { name: m.tool_name ?? "", response: { output: m.content } } }] as Part[],
          };
        }
        if (m.role === "assistant") {
          if (m.tool_calls && m.tool_calls.length > 0) {
            // Assistant turn that used tools → model turn with functionCall parts
            const parts: Part[] = [];
            if (m.content) parts.push({ text: m.content });
            for (const tc of m.tool_calls) {
              parts.push({ functionCall: { name: tc.tool_id, args: tc.input as Record<string, unknown> } });
            }
            return { role: "model", parts };
          }
          return { role: "model", parts: [{ text: m.content }] };
        }
        return { role: "user", parts: [{ text: m.content }] };
      });

    if (contents.length === 0) {
      yield { type: "error", error: "No messages provided" };
      return;
    }

    let streamResult: GenerateContentStreamResult;
    try {
      streamResult = await model.generateContentStream({
        contents,
        generationConfig: { maxOutputTokens: options.max_tokens ?? 4096 },
      });
    } catch (err) {
      yield { type: "error", error: `Gemini API error: ${String(err)}` };
      return;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    const toolCalls: FunctionCall[] = [];

    for await (const chunk of streamResult.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
          yield { type: "text", text: part.text };
        }
        if (part.functionCall) {
          toolCalls.push(part.functionCall);
        }
      }

      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
      }
    }

    // Emit tool calls after stream completes
    for (const tc of toolCalls) {
      yield {
        type: "tool_call",
        tool_call: {
          call_id: generateCallId(),
          tool_id: tc.name,
          input: tc.args as Record<string, unknown>,
        },
      };
    }

    yield {
      type: "finish",
      finish_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number
  ): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.model_name,
      systemInstruction: systemPrompt,
      generationConfig: { maxOutputTokens: maxTokens },
    });

    const result = await model.generateContent(userMessage);
    return result.response.text();
  }

  estimateCostUsd(inputTokens: number, outputTokens: number): number {
    return estimateCostUsd(this.model_name, inputTokens, outputTokens);
  }

  private toGeminiFunctionDeclaration(tool: LLMTool): FunctionDeclaration {
    // Cast through unknown to handle exactOptionalPropertyTypes conflict with external SDK types
    return {
      name: tool.id,
      description: tool.description,
    } as FunctionDeclaration;
  }
}
