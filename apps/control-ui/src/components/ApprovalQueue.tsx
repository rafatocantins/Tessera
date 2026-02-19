/**
 * ApprovalQueue.tsx — Pending tool-approval dashboard.
 *
 * Polls GET /api/v1/approvals every 2 s.
 * Approve/deny via POST /api/v1/sessions/:id/approve/:callId { approved }.
 * Countdown timer per card; turns red when < 60 s remaining.
 * Exposes `pendingCount` so App can show a badge on the tab.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useToken } from "../hooks/useToken.js";

interface ApprovalSummary {
  call_id: string;
  session_id: string;
  user_id: string;
  tool_id: string;
  input_preview: string;
  requested_at: number;
  expires_at: number;
}

interface ApprovalQueueProps {
  secret: string;
  onCountChange?: (count: number) => void;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.ceil(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function fmtRelative(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function ApprovalQueue({ secret, onCountChange }: ApprovalQueueProps) {
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [acting, setActing] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { getToken } = useToken(secret);
  const now = useNow(1000);
  const onCountRef = useRef(onCountChange);
  onCountRef.current = onCountChange;

  const fetchApprovals = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/v1/approvals", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { approvals: ApprovalSummary[] };
      setApprovals(data.approvals ?? []);
      setFetchError(null);
      onCountRef.current?.(data.approvals?.length ?? 0);
    } catch {
      setFetchError("Network error");
    }
  }, [getToken]);

  useEffect(() => {
    void fetchApprovals();
    const id = setInterval(() => void fetchApprovals(), 2000);
    return () => clearInterval(id);
  }, [fetchApprovals]);

  async function decide(approval: ApprovalSummary, approved: boolean) {
    setActing((prev) => new Set(prev).add(approval.call_id));
    // Optimistic removal
    setApprovals((prev) => prev.filter((a) => a.call_id !== approval.call_id));
    try {
      const token = await getToken();
      await fetch(`/api/v1/sessions/${approval.session_id}/approve/${approval.call_id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
    } catch {
      // Best effort; next poll will reflect actual state
    } finally {
      setActing((prev) => {
        const n = new Set(prev);
        n.delete(approval.call_id);
        return n;
      });
    }
  }

  return (
    <div style={s.root}>
      {fetchError && <div style={s.fetchError}>Poll error: {fetchError}</div>}

      {approvals.length === 0 ? (
        <div style={s.empty}>
          <span style={s.emptyIcon}>✓</span>
          <span>No pending approvals</span>
        </div>
      ) : (
        <div style={s.list}>
          {approvals.map((a) => {
            const remaining = a.expires_at - now;
            const urgent = remaining > 0 && remaining < 60_000;
            const expired = remaining <= 0;
            const busy = acting.has(a.call_id);
            return (
              <div key={a.call_id} style={{ ...s.card, ...(urgent ? s.cardUrgent : {}), ...(expired ? s.cardExpired : {}) }}>
                <div style={s.cardHeader}>
                  <span style={s.toolId}>{a.tool_id}</span>
                  <span style={{ ...s.countdown, ...(urgent || expired ? s.countdownRed : {}) }}>
                    {expired ? "expired" : fmtCountdown(remaining)}
                  </span>
                </div>

                <div style={s.meta}>
                  <span style={s.metaItem}>
                    session: <code style={s.code}>{a.session_id.slice(0, 8)}…</code>
                  </span>
                  {a.user_id && (
                    <span style={s.metaItem}>
                      user: <code style={s.code}>{a.user_id}</code>
                    </span>
                  )}
                  <span style={s.metaItem}>{fmtRelative(a.requested_at)}</span>
                </div>

                {a.input_preview && (
                  <pre style={s.preview}>{a.input_preview}</pre>
                )}

                <div style={s.actions}>
                  <button
                    style={{ ...s.btn, ...s.btnApprove, ...(busy || expired ? s.btnDisabled : {}) }}
                    disabled={busy || expired}
                    onClick={() => void decide(a, true)}
                  >
                    ✓ Approve
                  </button>
                  <button
                    style={{ ...s.btn, ...s.btnDeny, ...(busy ? s.btnDisabled : {}) }}
                    disabled={busy}
                    onClick={() => void decide(a, false)}
                  >
                    ✗ Deny
                  </button>
                </div>
              </div>
            );
          })}
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
  empty: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
    color: "#666", fontSize: "14px", padding: "60px 0",
  },
  emptyIcon: { fontSize: "24px", color: "#2a7a2a" },
  list: { display: "flex", flexDirection: "column" as const, gap: "12px" },
  card: {
    background: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", padding: "14px 16px",
    display: "flex", flexDirection: "column" as const, gap: "8px",
  },
  cardUrgent: { borderColor: "#8a4400" },
  cardExpired: { opacity: 0.5 },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  toolId: {
    fontSize: "13px", fontWeight: 700, color: "#f0a040",
    fontFamily: "monospace", background: "#2a1a00",
    border: "1px solid #5a3a00", borderRadius: "4px", padding: "2px 8px",
  },
  countdown: { fontSize: "12px", color: "#888", fontFamily: "monospace" },
  countdownRed: { color: "#f44" },
  meta: { display: "flex", gap: "12px", flexWrap: "wrap" as const, fontSize: "12px", color: "#888" },
  metaItem: {},
  code: { fontFamily: "monospace", color: "#89d", background: "#111", padding: "0 4px", borderRadius: "3px" },
  preview: {
    background: "#111", border: "1px solid #2a2a2a", borderRadius: "4px",
    padding: "8px 10px", fontSize: "12px", color: "#ccc",
    fontFamily: "monospace", whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const, margin: 0, maxHeight: "120px", overflowY: "auto" as const,
  },
  actions: { display: "flex", gap: "8px", marginTop: "2px" },
  btn: {
    fontSize: "12px", fontWeight: 600, borderRadius: "5px",
    padding: "6px 16px", cursor: "pointer", border: "none",
  },
  btnApprove: { background: "#1a4a1a", color: "#8f8", border: "1px solid #3a6a3a" },
  btnDeny: { background: "#3a1a1a", color: "#f88", border: "1px solid #6a2a2a" },
  btnDisabled: { opacity: 0.4, cursor: "not-allowed" as const },
} as const;
