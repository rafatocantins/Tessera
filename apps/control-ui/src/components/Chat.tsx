/**
 * Chat.tsx — Real-time agent chat panel.
 *
 * - Creates sessions via POST /api/v1/sessions
 * - Streams responses over WebSocket /api/v1/chat/{sessionId}
 * - Auth: token passed as ?token= query param (browsers can't set WS headers)
 * - Inline approve/deny buttons for tool calls requiring human approval
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useToken } from "../hooks/useToken.js";

// ── Types ──────────────────────────────────────────────────────────────────

type Provider = "anthropic" | "ollama";

type ChatEntry =
  | { id: string; kind: "user"; content: string }
  | { id: string; kind: "assistant"; content: string; streaming: boolean }
  | {
      id: string; kind: "tool_call";
      call_id: string; tool_id: string; description: string;
      requires_approval: boolean;
      status: "pending" | "approved" | "denied" | "done";
      success?: boolean; duration_ms?: number;
    }
  | { id: string; kind: "complete"; cost_usd: number; input_tokens: number; output_tokens: number }
  | { id: string; kind: "error"; code: string; message: string }
  | { id: string; kind: "injection_warning"; excerpt: string };

type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

interface ServerMsg {
  type: string;
  [key: string]: unknown;
}

// ── Component ──────────────────────────────────────────────────────────────

export function Chat({ secret }: { secret: string }) {
  const { getToken } = useToken(secret);

  const [provider, setProvider] = useState<Provider>("anthropic");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll thread to bottom when new entries arrive
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // ── WebSocket connection ─────────────────────────────────────────────────

  const connectWs = useCallback(
    async (sid: string) => {
      wsRef.current?.close();
      setWsStatus("connecting");
      setEntries([]);

      const token = await getToken();
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${location.host}/api/v1/chat/${sid}?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("open");

      ws.onclose = () => {
        setWsStatus("closed");
        setStreaming(false);
      };

      ws.onerror = () => {
        setWsStatus("error");
        setStreaming(false);
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data) as ServerMsg;
        } catch {
          return;
        }
        handleServerMsg(msg);
      };
    },
    [getToken]
  );

  // ── Server message handler ───────────────────────────────────────────────

  function handleServerMsg(msg: ServerMsg) {
    if (msg.type === "pong") return;

    if (msg.type === "chunk") {
      const delta = String(msg.delta ?? "");
      setStreaming(true);
      setEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last?.kind === "assistant" && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + delta },
          ];
        }
        return [
          ...prev,
          { id: crypto.randomUUID(), kind: "assistant", content: delta, streaming: true },
        ];
      });
      return;
    }

    if (msg.type === "tool_pending") {
      const call_id = String(msg.call_id ?? "");
      const tool_id = String(msg.tool_id ?? "");
      const description = String(msg.description ?? "");
      const requires_approval = Boolean(msg.requires_approval);
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(), kind: "tool_call",
          call_id, tool_id, description, requires_approval,
          status: requires_approval ? "pending" : "done",
        },
      ]);
      return;
    }

    if (msg.type === "tool_result") {
      const call_id = String(msg.call_id ?? "");
      const success = Boolean(msg.success);
      const duration_ms = Number(msg.duration_ms ?? 0);
      setEntries((prev) =>
        prev.map((e) =>
          e.kind === "tool_call" && e.call_id === call_id && e.status === "done"
            ? { ...e, success, duration_ms }
            : e
        )
      );
      return;
    }

    if (msg.type === "complete") {
      setStreaming(false);
      // Mark any still-streaming assistant message as done
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.kind === "assistant" && e.streaming ? { ...e, streaming: false } : e
        );
        return [
          ...next,
          {
            id: crypto.randomUUID(), kind: "complete",
            cost_usd: Number(msg.cost_usd ?? 0),
            input_tokens: Number(msg.input_tokens ?? 0),
            output_tokens: Number(msg.output_tokens ?? 0),
          },
        ];
      });
      return;
    }

    if (msg.type === "error") {
      setStreaming(false);
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: "error", code: String(msg.code ?? ""), message: String(msg.message ?? "") },
      ]);
      return;
    }

    if (msg.type === "injection_warning") {
      setStreaming(false);
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: "injection_warning", excerpt: String(msg.excerpt ?? "") },
      ]);
      return;
    }
  }

  // ── Session creation ─────────────────────────────────────────────────────

  async function createSession() {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: "control-ui", provider }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { session_id: string };
      setSessionId(data.session_id);
      await connectWs(data.session_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────

  function sendMessage() {
    const text = input.trim();
    if (!text || !sessionId || wsRef.current?.readyState !== WebSocket.OPEN || streaming) return;

    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), kind: "user", content: text },
    ]);
    setInput("");
    setStreaming(true);

    wsRef.current.send(JSON.stringify({
      type: "message",
      session_id: sessionId,
      content: text,
    }));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  function sendApproval(call_id: string, approved: boolean) {
    if (!sessionId || wsRef.current?.readyState !== WebSocket.OPEN) return;
    setEntries((prev) =>
      prev.map((e) =>
        e.kind === "tool_call" && e.call_id === call_id
          ? { ...e, status: approved ? "approved" : "denied" }
          : e
      )
    );
    wsRef.current.send(JSON.stringify({
      type: "approve",
      session_id: sessionId,
      call_id,
      approved,
    }));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const canSend = wsStatus === "open" && !streaming && input.trim().length > 0;

  return (
    <div style={s.root}>
      {/* Session bar */}
      <div style={s.sessionBar}>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          style={s.select}
          disabled={creating || wsStatus === "open"}
        >
          <option value="anthropic">Anthropic</option>
          <option value="ollama">Ollama (local)</option>
        </select>

        <button
          style={{ ...s.btn, ...(creating ? s.btnDisabled : {}) }}
          onClick={() => void createSession()}
          disabled={creating}
        >
          {creating ? "Starting…" : "New Chat"}
        </button>

        {sessionId && (
          <span style={s.sessionId} title={sessionId}>
            Session: <code style={s.code}>{sessionId.slice(0, 8)}…</code>
          </span>
        )}

        <span style={{ ...s.dot, background: WS_COLOR[wsStatus] }} title={`WebSocket: ${wsStatus}`} />

        {error && <span style={s.errorMsg}>{error}</span>}
      </div>

      {/* Thread */}
      <div ref={threadRef} style={s.thread}>
        {entries.length === 0 && wsStatus !== "open" && (
          <div style={s.empty}>Click "New Chat" to start a session.</div>
        )}
        {entries.length === 0 && wsStatus === "open" && (
          <div style={s.empty}>Session ready — type a message below.</div>
        )}

        {entries.map((entry) => {
          if (entry.kind === "user") {
            return (
              <div key={entry.id} style={s.rowUser}>
                <div style={s.bubbleUser}>{entry.content}</div>
              </div>
            );
          }

          if (entry.kind === "assistant") {
            return (
              <div key={entry.id} style={s.rowAssistant}>
                <div style={s.bubbleAssistant}>
                  <pre style={s.pre}>{entry.content}</pre>
                  {entry.streaming && <span style={s.cursor}>▋</span>}
                </div>
              </div>
            );
          }

          if (entry.kind === "tool_call") {
            const statusColor =
              entry.status === "approved" ? "#4caf50"
              : entry.status === "denied" ? "#f44336"
              : entry.status === "done" ? (entry.success === false ? "#ff9800" : "#4caf50")
              : "#888";

            return (
              <div key={entry.id} style={s.toolCard}>
                <div style={s.toolHeader}>
                  <span style={s.toolIcon}>⚙</span>
                  <span style={s.toolName}>{entry.tool_id}</span>
                  <span style={{ ...s.toolStatus, color: statusColor }}>
                    {entry.status === "done"
                      ? entry.success === false
                        ? `✗ failed${entry.duration_ms !== undefined ? ` (${entry.duration_ms}ms)` : ""}`
                        : `✓${entry.duration_ms !== undefined ? ` ${entry.duration_ms}ms` : ""}`
                      : entry.status === "approved" ? "✓ approved"
                      : entry.status === "denied" ? "✗ denied"
                      : "pending…"}
                  </span>
                </div>
                {entry.description && (
                  <div style={s.toolDesc}>{entry.description}</div>
                )}
                {entry.requires_approval && entry.status === "pending" && (
                  <div style={s.approvalRow}>
                    <button
                      style={{ ...s.approveBtn }}
                      onClick={() => sendApproval(entry.call_id, true)}
                    >
                      Approve
                    </button>
                    <button
                      style={{ ...s.denyBtn }}
                      onClick={() => sendApproval(entry.call_id, false)}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            );
          }

          if (entry.kind === "complete") {
            return (
              <div key={entry.id} style={s.receipt}>
                ✓ &nbsp;
                <span style={s.receiptVal}>${entry.cost_usd.toFixed(5)}</span>
                <span style={s.receiptSep}>·</span>
                <span style={s.receiptVal}>{fmtTokens(entry.input_tokens)} in</span>
                <span style={s.receiptSep}>·</span>
                <span style={s.receiptVal}>{fmtTokens(entry.output_tokens)} out</span>
              </div>
            );
          }

          if (entry.kind === "error") {
            return (
              <div key={entry.id} style={s.errorCard}>
                <span style={s.errorCode}>{entry.code}</span> {entry.message}
              </div>
            );
          }

          if (entry.kind === "injection_warning") {
            return (
              <div key={entry.id} style={s.warningCard}>
                ⚠ Prompt injection attempt detected and blocked.
                <div style={s.warningExcerpt}>{entry.excerpt}</div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Input bar */}
      <div style={s.inputBar}>
        <textarea
          style={s.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            wsStatus === "open"
              ? "Type a message… (Enter to send, Shift+Enter for newline)"
              : "Start a session to chat"
          }
          disabled={wsStatus !== "open" || streaming}
          rows={3}
        />
        <button
          style={{ ...s.sendBtn, ...(canSend ? {} : s.btnDisabled) }}
          onClick={sendMessage}
          disabled={!canSend}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const WS_COLOR: Record<WsStatus, string> = {
  idle: "#444",
  connecting: "#ff9800",
  open: "#4caf50",
  closed: "#666",
  error: "#f44336",
};

// ── Styles ─────────────────────────────────────────────────────────────────

const s = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    background: "#0f0f0f",
  },
  sessionBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 20px",
    borderBottom: "1px solid #1e1e1e",
    flexShrink: 0,
    flexWrap: "wrap" as const,
  },
  select: {
    background: "#1a1a1a",
    color: "#e0e0e0",
    border: "1px solid #333",
    borderRadius: "4px",
    padding: "5px 8px",
    fontSize: "12px",
    cursor: "pointer",
  },
  btn: {
    background: "#1e3a2f",
    color: "#4caf50",
    border: "1px solid #2e5a3f",
    borderRadius: "4px",
    padding: "5px 14px",
    fontSize: "12px",
    cursor: "pointer",
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed" as const,
  },
  sessionId: { fontSize: "11px", color: "#666" },
  code: { fontFamily: "monospace", color: "#aaa" },
  dot: {
    width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
  },
  errorMsg: { fontSize: "11px", color: "#f44336" },
  thread: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
  },
  empty: {
    color: "#444",
    fontSize: "13px",
    textAlign: "center" as const,
    marginTop: "60px",
  },
  rowUser: { display: "flex", justifyContent: "flex-end" },
  rowAssistant: { display: "flex", justifyContent: "flex-start" },
  bubbleUser: {
    maxWidth: "70%",
    background: "#1a2e1a",
    border: "1px solid #2a3e2a",
    borderRadius: "12px 12px 2px 12px",
    padding: "8px 12px",
    fontSize: "13px",
    lineHeight: "1.5",
    whiteSpace: "pre-wrap" as const,
    color: "#d0f0d0",
  },
  bubbleAssistant: {
    maxWidth: "80%",
    background: "#141414",
    border: "1px solid #222",
    borderRadius: "2px 12px 12px 12px",
    padding: "8px 12px",
    fontSize: "13px",
    lineHeight: "1.5",
    position: "relative" as const,
  },
  pre: {
    margin: 0,
    fontFamily: "inherit",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    color: "#e0e0e0",
  },
  cursor: {
    display: "inline-block",
    animation: "blink 1s step-end infinite",
    color: "#4caf50",
    fontSize: "14px",
    lineHeight: 1,
  },
  toolCard: {
    background: "#111",
    border: "1px solid #1e2e1e",
    borderLeft: "3px solid #2e4a2e",
    borderRadius: "4px",
    padding: "8px 12px",
    fontSize: "12px",
    maxWidth: "60%",
  },
  toolHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "4px",
  },
  toolIcon: { color: "#555", fontSize: "11px" },
  toolName: { color: "#aaa", fontFamily: "monospace", fontWeight: 600 },
  toolStatus: { marginLeft: "auto", fontSize: "11px" },
  toolDesc: {
    color: "#666",
    fontSize: "11px",
    fontFamily: "monospace",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    marginTop: "4px",
  },
  approvalRow: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  },
  approveBtn: {
    background: "#1e3a2f",
    color: "#4caf50",
    border: "1px solid #2e5a3f",
    borderRadius: "4px",
    padding: "4px 12px",
    fontSize: "11px",
    cursor: "pointer",
    fontWeight: 600,
  },
  denyBtn: {
    background: "#2a1a1a",
    color: "#f44336",
    border: "1px solid #4a2a2a",
    borderRadius: "4px",
    padding: "4px 12px",
    fontSize: "11px",
    cursor: "pointer",
  },
  receipt: {
    fontSize: "11px",
    color: "#555",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    paddingLeft: "4px",
  },
  receiptVal: { color: "#888" },
  receiptSep: { color: "#333" },
  errorCard: {
    background: "#1a0000",
    border: "1px solid #3a1a1a",
    borderRadius: "4px",
    padding: "8px 12px",
    fontSize: "12px",
    color: "#f88",
  },
  errorCode: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: "#f44",
    marginRight: "6px",
  },
  warningCard: {
    background: "#1a1500",
    border: "1px solid #3a3000",
    borderRadius: "4px",
    padding: "8px 12px",
    fontSize: "12px",
    color: "#ff9800",
  },
  warningExcerpt: {
    marginTop: "4px",
    fontSize: "11px",
    color: "#856",
    fontFamily: "monospace",
    whiteSpace: "pre-wrap" as const,
  },
  inputBar: {
    display: "flex",
    gap: "10px",
    padding: "12px 20px",
    borderTop: "1px solid #1e1e1e",
    alignItems: "flex-end",
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    background: "#141414",
    color: "#e0e0e0",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    padding: "8px 10px",
    fontSize: "13px",
    resize: "none" as const,
    fontFamily: "system-ui, -apple-system, sans-serif",
    lineHeight: "1.5",
    outline: "none",
  },
  sendBtn: {
    background: "#1e3a2f",
    color: "#4caf50",
    border: "1px solid #2e5a3f",
    borderRadius: "6px",
    padding: "8px 18px",
    fontSize: "13px",
    cursor: "pointer",
    fontWeight: 600,
    flexShrink: 0,
    alignSelf: "flex-end" as const,
    height: "36px",
  },
} as const;
