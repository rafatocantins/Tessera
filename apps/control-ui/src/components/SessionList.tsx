/**
 * SessionList.tsx — Active session table with cost tracking.
 *
 * Polls GET /api/v1/sessions every 5 s.
 * Sort: "awaiting_approval" first, then by last_activity_at DESC.
 * Terminate via DELETE /api/v1/sessions/:id with confirmation.
 */
import { useState, useEffect, useCallback } from "react";
import { useToken } from "../hooks/useToken.js";

interface SessionSummary {
  session_id: string;
  user_id: string;
  provider: string;
  status: string;
  created_at: number;
  last_activity_at: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  tool_call_count: number;
}

interface SessionListProps {
  secret: string;
}

function fmtRelative(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const STATUS_STYLE: Record<string, { background: string; color: string; border: string }> = {
  active:             { background: "#1a3a1a", color: "#4f4",  border: "1px solid #2a5a2a" },
  awaiting_approval:  { background: "#3a2a00", color: "#fa0",  border: "1px solid #6a4a00" },
  idle:               { background: "#1a1a2a", color: "#88f",  border: "1px solid #2a2a5a" },
  terminated:         { background: "#2a1a1a", color: "#888",  border: "1px solid #3a2a2a" },
};

function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE["idle"];
  return (
    <span style={{ ...s.pill, ...style }}>
      {status.replace("_", " ")}
    </span>
  );
}

export function SessionList({ secret }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [terminating, setTerminating] = useState<Set<string>>(new Set());
  const { getToken } = useToken(secret);

  const fetchSessions = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/v1/sessions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { sessions: SessionSummary[] };
      const sorted = (data.sessions ?? []).sort((a, b) => {
        if (a.status === "awaiting_approval" && b.status !== "awaiting_approval") return -1;
        if (b.status === "awaiting_approval" && a.status !== "awaiting_approval") return 1;
        return b.last_activity_at - a.last_activity_at;
      });
      setSessions(sorted);
      setFetchError(null);
    } catch {
      setFetchError("Network error");
    }
  }, [getToken]);

  useEffect(() => {
    void fetchSessions();
    const id = setInterval(() => void fetchSessions(), 5000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  async function terminate(id: string) {
    if (!window.confirm(`Terminate session ${id.slice(0, 8)}…?`)) return;
    setTerminating((prev) => new Set(prev).add(id));
    try {
      const token = await getToken();
      await fetch(`/api/v1/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setSessions((prev) => prev.filter((s) => s.session_id !== id));
    } catch {
      // Next poll will refresh
    } finally {
      setTerminating((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  return (
    <div style={s.root}>
      {fetchError && <div style={s.fetchError}>Poll error: {fetchError}</div>}

      {sessions.length === 0 && !fetchError ? (
        <div style={s.empty}>No active sessions</div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {["User", "Provider", "Status", "Cost", "Tokens (in/out)", "Tools", "Started", ""].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((sess) => (
                <tr key={sess.session_id} style={s.tr}>
                  <td style={s.td}>
                    <div style={s.userId}>{sess.user_id || <em style={s.dim}>—</em>}</div>
                    <div style={s.sessionId}>{sess.session_id.slice(0, 8)}…</div>
                  </td>
                  <td style={{ ...s.td, ...s.mono }}>{sess.provider || "—"}</td>
                  <td style={s.td}><StatusPill status={sess.status} /></td>
                  <td style={{ ...s.td, ...s.mono, color: sess.total_cost_usd > 0.10 ? "#f84" : "#ccc" }}>
                    {fmtCost(sess.total_cost_usd)}
                  </td>
                  <td style={{ ...s.td, ...s.mono, color: "#aaa" }}>
                    {fmtTokens(sess.total_input_tokens)} / {fmtTokens(sess.total_output_tokens)}
                  </td>
                  <td style={{ ...s.td, ...s.mono, color: "#aaa", textAlign: "center" as const }}>
                    {sess.tool_call_count}
                  </td>
                  <td style={{ ...s.td, color: "#777", fontSize: "12px" }}>
                    {fmtRelative(sess.created_at)}
                  </td>
                  <td style={s.td}>
                    <button
                      style={{
                        ...s.terminateBtn,
                        ...(terminating.has(sess.session_id) ? s.terminateBtnDisabled : {}),
                      }}
                      disabled={terminating.has(sess.session_id)}
                      onClick={() => void terminate(sess.session_id)}
                    >
                      {terminating.has(sess.session_id) ? "…" : "Terminate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const s = {
  root: { padding: "20px", display: "flex", flexDirection: "column" as const, gap: "12px" },
  fetchError: {
    fontSize: "12px", color: "#f44", background: "#1a0000",
    border: "1px solid #5a1111", borderRadius: "4px", padding: "6px 10px",
  },
  empty: { color: "#666", fontSize: "14px", padding: "60px 0", textAlign: "center" as const },
  tableWrap: { overflowX: "auto" as const },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: {
    textAlign: "left" as const, color: "#888", fontSize: "11px",
    fontWeight: 600, letterSpacing: "0.04em",
    padding: "6px 10px", borderBottom: "1px solid #2a2a2a",
  },
  tr: { borderBottom: "1px solid #1e1e1e" },
  td: { padding: "10px 10px", verticalAlign: "middle" as const, color: "#ddd" },
  userId: { fontWeight: 600, color: "#e0e0e0" },
  sessionId: { fontSize: "11px", color: "#555", fontFamily: "monospace" },
  mono: { fontFamily: "monospace" },
  dim: { color: "#555", fontStyle: "normal" },
  pill: {
    display: "inline-block", fontSize: "11px", fontWeight: 600,
    padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap" as const,
  },
  terminateBtn: {
    fontSize: "11px", padding: "4px 10px", cursor: "pointer",
    background: "#2a1a1a", color: "#f88", border: "1px solid #5a2a2a",
    borderRadius: "4px",
  },
  terminateBtnDisabled: { opacity: 0.4, cursor: "not-allowed" as const },
} as const;
