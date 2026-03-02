/**
 * bot.ts — Telegram channel adapter for Tessera.
 *
 * Uses Telegraf (TypeScript-first Telegram bot framework).
 * Maintains one long-lived WebSocket per Telegram chat.
 * Streams responses by editing the in-progress Telegram message ≥500ms apart.
 * Tool approval via inline keyboard callback queries.
 */
import { Telegraf } from "telegraf";
import type { WebSocket } from "ws";
import {
  generateToken,
  createSession,
  openChat,
  terminateSession,
} from "./gateway-client.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface UserSession {
  sessionId: string;
  ws: WebSocket;
  replyMsgId?: number; // Telegram message being streamed (for edits)
  buffer: string; // accumulated text chunks
  lastEdit: number; // timestamp of last edit (rate-limit)
  inactivityTimer: ReturnType<typeof setTimeout>;
}

interface ServerMessage {
  type: string;
  delta?: string;
  call_id?: string;
  tool_id?: string;
  description?: string;
  requires_approval?: boolean;
  success?: boolean;
  duration_ms?: number;
  excerpt?: string;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  code?: string;
  message?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
const EDIT_INTERVAL_MS = 500; // minimum ms between Telegram edits

// ── TelegramChannel ────────────────────────────────────────────────────────

export class TelegramChannel {
  private readonly bot: Telegraf;
  private readonly sessions = new Map<number, UserSession>();

  constructor(
    private readonly botToken: string,
    private readonly gatewayUrl: string,
    private readonly hmacSecret: string
  ) {
    this.bot = new Telegraf(botToken);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    // Handle all text messages (including DMs and group mentions)
    this.bot.on("text", async (ctx) => {
      const chatId = ctx.chat.id;
      const content = ctx.message.text;

      let session = this.sessions.get(chatId);

      if (!session) {
        // Create new gateway session and open WebSocket
        const userId = `telegram:${chatId}`;
        const token = generateToken(userId, this.hmacSecret);
        let sessionId: string;
        try {
          sessionId = await createSession(this.gatewayUrl, token);
        } catch (err) {
          await ctx.reply(
            `Failed to connect to Tessera: ${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }

        const wsToken = generateToken(userId, this.hmacSecret);
        const ws = openChat(this.gatewayUrl, sessionId, wsToken);

        const inactivityTimer = this.createInactivityTimer(chatId);

        session = {
          sessionId,
          ws,
          buffer: "",
          lastEdit: 0,
          inactivityTimer,
        };
        this.sessions.set(chatId, session);

        // Attach WebSocket listeners
        ws.on("message", (raw: Buffer) => {
          void this.handleServerMessage(chatId, raw);
        });

        ws.on("close", () => {
          const s = this.sessions.get(chatId);
          if (s) {
            clearTimeout(s.inactivityTimer);
            this.sessions.delete(chatId);
          }
        });

        ws.on("error", (err: Error) => {
          process.stderr.write(
            `[telegram] WS error for chat ${chatId}: ${err.message}\n`
          );
        });

        // Wait for WS to open before sending
        await new Promise<void>((resolve, reject) => {
          ws.on("open", resolve);
          ws.on("error", reject);
        });
      } else {
        // Reset inactivity timer on new message
        clearTimeout(session.inactivityTimer);
        session.inactivityTimer = this.createInactivityTimer(chatId);
      }

      // Send message to gateway
      session.ws.send(
        JSON.stringify({
          type: "message",
          session_id: session.sessionId,
          content,
        })
      );
    });

    // Inline keyboard callback for tool approval
    this.bot.on("callback_query", async (ctx) => {
      const data = ctx.callbackQuery && "data" in ctx.callbackQuery
        ? ctx.callbackQuery.data
        : undefined;

      if (!data?.startsWith("a:")) {
        await ctx.answerCbQuery();
        return;
      }

      // Format: "a:{callId}:{1|0}"
      const parts = data.split(":");
      if (parts.length !== 3) {
        await ctx.answerCbQuery("Invalid approval data");
        return;
      }

      const callId = parts[1] ?? "";
      const approved = parts[2] === "1";
      const chatId = ctx.chat?.id;

      if (!chatId) {
        await ctx.answerCbQuery();
        return;
      }

      const session = this.sessions.get(chatId);
      if (!session) {
        await ctx.answerCbQuery("Session expired");
        return;
      }

      session.ws.send(
        JSON.stringify({
          type: "approve",
          session_id: session.sessionId,
          call_id: callId,
          approved,
        })
      );

      await ctx.answerCbQuery(approved ? "Approved" : "Denied");

      // Update the inline keyboard message to show result
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(
          `${approved ? "✓ Approved" : "✗ Denied"}: tool call`
        );
      }
    });
  }

  private async handleServerMessage(
    chatId: number,
    raw: Buffer
  ): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw.toString("utf-8")) as ServerMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "chunk": {
        if (msg.delta) {
          session.buffer += msg.delta;
        }
        const now = Date.now();
        if (now - session.lastEdit >= EDIT_INTERVAL_MS) {
          await this.flushBuffer(chatId, session, false);
        }
        break;
      }

      case "tool_pending": {
        // Flush any buffered text first
        await this.flushBuffer(chatId, session, true);

        if (msg.requires_approval) {
          // Inline keyboard: callback_data "a:{callId}:{1|0}" ≤ 64 bytes
          const cbApprove = `a:${msg.call_id ?? ""}:1`;
          const cbDeny = `a:${msg.call_id ?? ""}:0`;
          try {
            await this.bot.telegram.sendMessage(
              chatId,
              `⚠️ Approval required\nTool: \`${msg.tool_id ?? ""}\`\n${msg.description ?? ""}`,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "✓ Approve", callback_data: cbApprove },
                      { text: "✗ Deny", callback_data: cbDeny },
                    ],
                  ],
                },
              }
            );
          } catch (err) {
            process.stderr.write(
              `[telegram] sendMessage approval error: ${err instanceof Error ? err.message : String(err)}\n`
            );
          }
        } else {
          try {
            await this.bot.telegram.sendMessage(
              chatId,
              `🔧 Running: ${msg.tool_id ?? ""}…`
            );
          } catch (err) {
            process.stderr.write(
              `[telegram] sendMessage tool error: ${err instanceof Error ? err.message : String(err)}\n`
            );
          }
        }
        break;
      }

      case "tool_result": {
        const icon = msg.success ? "✓" : "✗";
        try {
          await this.bot.telegram.sendMessage(
            chatId,
            `${icon} ${msg.tool_id ?? ""} (${msg.duration_ms ?? 0}ms)`
          );
        } catch (err) {
          process.stderr.write(
            `[telegram] sendMessage tool_result error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }
        break;
      }

      case "injection_warning": {
        try {
          await this.bot.telegram.sendMessage(
            chatId,
            "⚠️ Prompt injection attempt blocked."
          );
        } catch (err) {
          process.stderr.write(
            `[telegram] sendMessage injection_warning error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }
        break;
      }

      case "complete": {
        // Final flush
        await this.flushBuffer(chatId, session, true);

        if ((msg.cost_usd ?? 0) > 0) {
          try {
            await this.bot.telegram.sendMessage(
              chatId,
              `💰 $${(msg.cost_usd ?? 0).toFixed(4)} (${(msg.input_tokens ?? 0) + (msg.output_tokens ?? 0)} tokens)`
            );
          } catch {
            // Non-critical
          }
        }

        // Clear streaming state for next turn
        delete session.replyMsgId;
        session.buffer = "";
        session.lastEdit = 0;
        break;
      }

      case "error": {
        // Flush partial buffer on error
        if (session.buffer) {
          await this.flushBuffer(chatId, session, true);
        }
        try {
          await this.bot.telegram.sendMessage(
            chatId,
            `Error [${msg.code ?? "UNKNOWN"}]: ${msg.message ?? "Unknown error"}`
          );
        } catch (err) {
          process.stderr.write(
            `[telegram] sendMessage error error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }
        break;
      }

      case "pong":
        // No-op — keep-alive acknowledgement
        break;
    }
  }

  private async flushBuffer(
    chatId: number,
    session: UserSession,
    force: boolean
  ): Promise<void> {
    const now = Date.now();
    if (!force && now - session.lastEdit < EDIT_INTERVAL_MS) return;
    if (!session.buffer) return;

    session.lastEdit = now;

    if (session.replyMsgId === undefined) {
      // First chunk — send a new message
      try {
        const sent = await this.bot.telegram.sendMessage(
          chatId,
          session.buffer
        );
        session.replyMsgId = sent.message_id;
      } catch (err) {
        process.stderr.write(
          `[telegram] sendMessage error: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    } else {
      // Subsequent chunks — edit the existing message
      try {
        await this.bot.telegram.editMessageText(
          chatId,
          session.replyMsgId,
          undefined,
          session.buffer
        );
      } catch (err) {
        // Ignore "message is not modified" errors (same content)
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("message is not modified")) {
          process.stderr.write(`[telegram] editMessageText error: ${msg}\n`);
        }
      }
    }
  }

  private createInactivityTimer(chatId: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      void this.teardown(chatId);
    }, INACTIVITY_MS);
  }

  private teardown(chatId: number): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    clearTimeout(session.inactivityTimer);
    session.ws.close();

    const userId = `telegram:${chatId}`;
    const token = generateToken(userId, this.hmacSecret);
    terminateSession(this.gatewayUrl, session.sessionId, token);

    this.sessions.delete(chatId);
  }

  start(): void {
    void this.bot.launch();
    process.stdout.write("[telegram] Bot started (long polling)\n");
  }

  stop(signal?: string): void {
    this.bot.stop(signal);

    // Tear down all active sessions
    for (const chatId of this.sessions.keys()) {
      this.teardown(chatId);
    }

    process.stdout.write("[telegram] Bot stopped\n");
  }
}
