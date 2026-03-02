/**
 * app.ts — Slack channel adapter for Tessera.
 *
 * Uses @slack/bolt in Socket Mode (no public HTTP server required).
 * Maintains one long-lived WebSocket per Slack user.
 * Streams responses by updating the in-progress Slack message ≥500ms apart.
 * Tool approval via Block Kit interactive buttons.
 */
import { App } from "@slack/bolt";
import type { BlockAction, ButtonAction } from "@slack/bolt";
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
  channelId: string;
  ts?: string; // Slack message timestamp for chat.update
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
const EDIT_INTERVAL_MS = 500; // minimum ms between Slack updates

// ── SlackChannel ───────────────────────────────────────────────────────────

export class SlackChannel {
  private readonly app: App;
  private readonly sessions = new Map<string, UserSession>();

  constructor(
    private readonly gatewayUrl: string,
    private readonly hmacSecret: string,
    botToken: string,
    appToken: string
  ) {
    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // Handle all incoming direct messages
    this.app.message(async ({ message, say }) => {
      // Type guard: only handle user messages with text
      if (
        message.subtype !== undefined ||
        !("text" in message) ||
        !message.text ||
        !("user" in message) ||
        !message.user
      ) {
        return;
      }

      const slackUserId = message.user;
      const channelId = message.channel;
      const content = message.text;

      let session = this.sessions.get(slackUserId);

      if (!session) {
        const userId = `slack:${slackUserId}`;
        const token = generateToken(userId, this.hmacSecret);
        let sessionId: string;
        try {
          sessionId = await createSession(this.gatewayUrl, token);
        } catch (err) {
          await say({
            text: `Failed to connect to Tessera: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        const wsToken = generateToken(userId, this.hmacSecret);
        const ws = openChat(this.gatewayUrl, sessionId, wsToken);

        const inactivityTimer = this.createInactivityTimer(slackUserId);

        session = {
          sessionId,
          ws,
          channelId,
          buffer: "",
          lastEdit: 0,
          inactivityTimer,
        };
        this.sessions.set(slackUserId, session);

        // Attach WebSocket listeners
        ws.on("message", (raw: Buffer) => {
          void this.handleServerMessage(slackUserId, raw);
        });

        ws.on("close", () => {
          const s = this.sessions.get(slackUserId);
          if (s) {
            clearTimeout(s.inactivityTimer);
            this.sessions.delete(slackUserId);
          }
        });

        ws.on("error", (err: Error) => {
          process.stderr.write(
            `[slack] WS error for user ${slackUserId}: ${err.message}\n`
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
        session.inactivityTimer = this.createInactivityTimer(slackUserId);
        // Update channel in case user messages from a different DM channel
        session.channelId = channelId;
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

    // Block Kit button actions for tool approval
    // Generic BlockAction<ButtonAction> gives us properly typed action + body
    this.app.action<BlockAction<ButtonAction>>(
      { action_id: /^approve_(yes|no)$/ },
      async ({ action, body, ack, client }) => {
        // Must ack within 3 seconds (Slack requirement)
        await ack();

        const value = action.value ?? "";
        const slashIdx = value.indexOf("/");
        if (slashIdx === -1) return;

        const sessionId = value.slice(0, slashIdx);
        const callId = value.slice(slashIdx + 1);
        const approved = action.action_id === "approve_yes";
        const slackUserId = body.user.id;

        const session = this.sessions.get(slackUserId);
        if (session) {
          session.ws.send(
            JSON.stringify({
              type: "approve",
              session_id: sessionId,
              call_id: callId,
              approved,
            })
          );
        }

        // Update the Block Kit message to show approval result
        const msg = body.message;
        const channelId = body.container["channel_id"] as string | undefined;
        if (msg?.ts && channelId) {
          try {
            await client.chat.update({
              channel: channelId,
              ts: msg.ts,
              text: approved
                ? `✓ Approved: tool call \`${callId}\``
                : `✗ Denied: tool call \`${callId}\``,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: approved
                      ? `✓ *Approved* tool call \`${callId}\``
                      : `✗ *Denied* tool call \`${callId}\``,
                  },
                },
              ],
            });
          } catch (err) {
            process.stderr.write(
              `[slack] chat.update approval error: ${err instanceof Error ? err.message : String(err)}\n`
            );
          }
        }
      }
    );
  }

  private async handleServerMessage(
    slackUserId: string,
    raw: Buffer
  ): Promise<void> {
    const session = this.sessions.get(slackUserId);
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
          await this.flushBuffer(session, false);
        }
        break;
      }

      case "tool_pending": {
        // Flush any buffered text first
        await this.flushBuffer(session, true);
        delete session.ts; // next text starts a new message

        if (msg.requires_approval) {
          const approveValue = `${session.sessionId}/${msg.call_id ?? ""}`;
          try {
            await this.app.client.chat.postMessage({
              channel: session.channelId,
              text: `⚠️ Approval required for tool: \`${msg.tool_id ?? ""}\``,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `⚠️ *Approval required*\nTool: \`${msg.tool_id ?? ""}\`\n${msg.description ?? ""}`,
                  },
                },
                {
                  type: "actions",
                  block_id: `approve_${msg.call_id ?? ""}`,
                  elements: [
                    {
                      type: "button",
                      action_id: "approve_yes",
                      text: { type: "plain_text", text: "✓ Approve", emoji: false },
                      style: "primary",
                      value: approveValue,
                    },
                    {
                      type: "button",
                      action_id: "approve_no",
                      text: { type: "plain_text", text: "✗ Deny", emoji: false },
                      style: "danger",
                      value: approveValue,
                    },
                  ],
                },
              ],
            });
          } catch (err) {
            process.stderr.write(
              `[slack] postMessage approval error: ${err instanceof Error ? err.message : String(err)}\n`
            );
          }
        } else {
          try {
            await this.app.client.chat.postMessage({
              channel: session.channelId,
              text: `🔧 Running: \`${msg.tool_id ?? ""}\`…`,
            });
          } catch (err) {
            process.stderr.write(
              `[slack] postMessage tool error: ${err instanceof Error ? err.message : String(err)}\n`
            );
          }
        }
        break;
      }

      case "tool_result": {
        const icon = msg.success ? "✓" : "✗";
        try {
          await this.app.client.chat.postMessage({
            channel: session.channelId,
            text: `${icon} \`${msg.tool_id ?? ""}\` (${msg.duration_ms ?? 0}ms)`,
          });
        } catch (err) {
          process.stderr.write(
            `[slack] postMessage tool_result error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }
        break;
      }

      case "injection_warning": {
        try {
          await this.app.client.chat.postMessage({
            channel: session.channelId,
            text: "⚠️ Prompt injection attempt blocked.",
          });
        } catch (err) {
          process.stderr.write(
            `[slack] postMessage injection_warning error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }
        break;
      }

      case "complete": {
        // Final flush
        await this.flushBuffer(session, true);

        if ((msg.cost_usd ?? 0) > 0) {
          try {
            await this.app.client.chat.postMessage({
              channel: session.channelId,
              text: `💰 $${(msg.cost_usd ?? 0).toFixed(4)} (${(msg.input_tokens ?? 0) + (msg.output_tokens ?? 0)} tokens)`,
            });
          } catch {
            // Non-critical
          }
        }

        // Clear streaming state for next turn
        delete session.ts;
        session.buffer = "";
        session.lastEdit = 0;
        break;
      }

      case "error": {
        if (session.buffer) {
          await this.flushBuffer(session, true);
        }
        try {
          await this.app.client.chat.postMessage({
            channel: session.channelId,
            text: `Error [${msg.code ?? "UNKNOWN"}]: ${msg.message ?? "Unknown error"}`,
          });
        } catch (err) {
          process.stderr.write(
            `[slack] postMessage error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }
        break;
      }

      case "pong":
        // No-op
        break;
    }
  }

  private async flushBuffer(
    session: UserSession,
    force: boolean
  ): Promise<void> {
    const now = Date.now();
    if (!force && now - session.lastEdit < EDIT_INTERVAL_MS) return;
    if (!session.buffer) return;

    session.lastEdit = now;

    if (!session.ts) {
      // First chunk — post a new message
      try {
        const res = await this.app.client.chat.postMessage({
          channel: session.channelId,
          text: session.buffer,
        });
        // res.ts may be string | undefined; only assign when it's a string
        if (typeof res.ts === "string") {
          session.ts = res.ts;
        }
      } catch (err) {
        process.stderr.write(
          `[slack] postMessage error: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    } else {
      // Subsequent chunks — update the existing message
      try {
        await this.app.client.chat.update({
          channel: session.channelId,
          ts: session.ts,
          text: session.buffer,
        });
      } catch (err) {
        process.stderr.write(
          `[slack] chat.update error: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  private createInactivityTimer(
    slackUserId: string
  ): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.teardown(slackUserId);
    }, INACTIVITY_MS);
  }

  private teardown(slackUserId: string): void {
    const session = this.sessions.get(slackUserId);
    if (!session) return;

    clearTimeout(session.inactivityTimer);
    session.ws.close();

    const userId = `slack:${slackUserId}`;
    const token = generateToken(userId, this.hmacSecret);
    terminateSession(this.gatewayUrl, session.sessionId, token);

    this.sessions.delete(slackUserId);
  }

  async start(): Promise<void> {
    await this.app.start();
    process.stdout.write("[slack] App started (Socket Mode)\n");
  }

  async stop(): Promise<void> {
    await this.app.stop();

    for (const userId of this.sessions.keys()) {
      this.teardown(userId);
    }

    process.stdout.write("[slack] App stopped\n");
  }
}
