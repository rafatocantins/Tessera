/**
 * mock-llm.ts — Minimal HTTP server that implements the Anthropic SSE streaming
 * API format for integration tests.
 *
 * The server maintains a scenario queue. Each POST /v1/messages call dequeues the
 * next scenario and returns a scripted SSE stream. Tests push scenarios via the
 * control endpoint POST /__mock/queue or via the queueScenario() helper method.
 *
 * Scenarios:
 *   { type: "text", content, inputTokens?, outputTokens? }
 *     → returns a text response stream (stop_reason: end_turn)
 *
 *   { type: "tool_use", toolName, toolInput, followUpText? }
 *     → queues TWO responses: tool_use stream + a follow-up text stream.
 *       The agent calls the LLM a second time after processing the tool result.
 *
 * Token counts default to USAGE_LARGE (10 M each) so that a single call
 * produces ~$80 of fake cost, comfortably exceeding the $0.001 test cap.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// ~$80 for claude-3-5-haiku: (10M * 0.8 + 10M * 4.0) / 1M = $48 — well above $0.001
const USAGE_LARGE = { input_tokens: 10_000_000, output_tokens: 10_000_000 };

export type LlmScenario =
  | { type: "text"; content: string; inputTokens?: number; outputTokens?: number }
  | { type: "tool_use"; toolName: string; toolInput: Record<string, unknown>; followUpText?: string };

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildTextSse(
  content: string,
  inputTokens: number,
  outputTokens: number
): string {
  return [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-3-5-haiku-20241022",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    sseEvent("ping", { type: "ping" }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: content },
    }),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: outputTokens },
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ].join("");
}

function buildToolUseSse(
  toolName: string,
  toolInput: Record<string, unknown>,
  inputTokens: number,
  outputTokens: number
): string {
  const toolId = `toolu_test_${Date.now()}`;
  return [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: "msg_test_tool",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-3-5-haiku-20241022",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: toolId, name: toolName, input: {} },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(toolInput) },
    }),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: outputTokens },
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ].join("");
}

export interface MockLlmServer {
  port: number;
  /** Push a scenario onto the queue. tool_use scenarios push two entries. */
  queueScenario(s: LlmScenario): void;
  callCount(): number;
  close(): Promise<void>;
}

export function createMockLlmServer(port = 11435): Promise<MockLlmServer> {
  const queue: string[] = [];
  let calls = 0;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "POST" && req.url === "/__mock/queue") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const { scenario } = JSON.parse(body) as { scenario: LlmScenario };
          enqueue(scenario);
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end("Bad JSON");
        }
      });
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      // Drain request body before responding
      req.resume();
      req.on("end", () => {
        calls++;
        const sseBody = queue.shift() ?? buildTextSse("OK", 1, 1);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.end(sseBody);
      });
      return;
    }

    res.writeHead(404).end("Not found");
  });

  function enqueue(scenario: LlmScenario): void {
    if (scenario.type === "text") {
      const inp = scenario.inputTokens ?? USAGE_LARGE.input_tokens;
      const out = scenario.outputTokens ?? USAGE_LARGE.output_tokens;
      queue.push(buildTextSse(scenario.content, inp, out));
    } else {
      // tool_use: enqueue two SSE bodies — call 1 (tool_use), call 2 (follow-up text)
      queue.push(
        buildToolUseSse(
          scenario.toolName,
          scenario.toolInput,
          USAGE_LARGE.input_tokens,
          USAGE_LARGE.output_tokens
        )
      );
      queue.push(
        buildTextSse(
          scenario.followUpText ?? "The operation was not performed.",
          USAGE_LARGE.input_tokens,
          USAGE_LARGE.output_tokens
        )
      );
    }
  }

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "0.0.0.0", () => {
      resolve({
        port,
        queueScenario: enqueue,
        callCount: () => calls,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res()))
          ),
      });
    });
  });
}

/** HTTP helper: push a scenario to a running mock LLM server by URL. */
export async function queueScenario(
  serverUrl: string,
  scenario: LlmScenario
): Promise<void> {
  const res = await fetch(`${serverUrl}/__mock/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!res.ok) throw new Error(`queueScenario failed: ${res.status}`);
}
