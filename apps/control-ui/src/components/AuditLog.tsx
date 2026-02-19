/**
 * AuditLog.tsx — Paginated audit event viewer.
 *
 * - Initial load: last 50 events (offset=0)
 * - "Load more" button: increments offset
 * - Auto-refresh toggle: polls every 5 s, inserts new events at top
 * - Filter bar: severity (INFO/WARN/ERROR/CRITICAL) + session_id text input
 * - Severity colour-coding; CRITICAL/ERROR rows highlighted
 * - Payload JSON expandable on click
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useToken } from "../hooks/useToken.js";

interface AuditEvent {
  event_id: string;
  session_id: string;
  event_type: string;
  severity: string;
  created_at: number;
  payload: string;
}

interface AuditLogProps {
  secret: string;
}

const SEVERITY_STYLE: Record<string, { background: string; color: string; border: string }> = {
  INFO:     { background: "#1a2a3a", color: "#7af",  border: "1px solid #2a4a6a" },
  WARN:     { background: "#3a2a00", color: "#fa0",  border: "1px solid #6a4a00" },
  ERROR:    { background: "#3a1a1a", color: "#f66",  border: "1px solid #6a2a2a" },
  CRITICAL: { background: "#4a0000", color: "#f44",  border: "1px solid #8a0000" },
};

const ROW_HIGHLIGHT: Record<string, { background: string }> = {
  ERROR:    { background: "#1e0f0f" },
  CRITICAL: { background: "#200000" },
};

function SeverityChip({ severity }: { severity: string }) {
  const style = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE["INFO"];
  return (
    <span style={{ ...s.chip, ...style }}>{severity}</span>
  );
}

function fmtTs(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 23);
}

function PayloadCell({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // leave as-is
  }
  return (
    <span>
      {open ? (
        <pre style={s.preOpen} onClick={() => setOpen(false)}>
          {pretty}
        </pre>
      ) : (
        <span
          style={s.preCollapsed}
          onClick={() => setOpen(true)}
          title="Click to expand"
        >
          {raw.slice(0, 60)}{raw.length > 60 ? "…" : ""}
        </span>
      )}
    </span>
  );
}

const PAGE_SIZE = 50;

export function AuditLog({ secret }: AuditLogProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterSession, setFilterSession] = useState("");
  const { getToken } = useToken(secret);
  const latestIdRef = useRef<string | null>(null);

  const fetchPage = useCallback(async (pageOffset: number, replace: boolean) => {
    setLoading(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams({
        offset: String(pageOffset),
        limit: String(PAGE_SIZE),
        ...(filterSeverity ? { severity: filterSeverity } : {}),
        ...(filterSession ? { session_id: filterSession } : {}),
      });
      const res = await fetch(`/api/v1/audit/events?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { events: AuditEvent[]; total_returned: number };
      const incoming = data.events ?? [];
      setFetchError(null);
      setHasMore(incoming.length === PAGE_SIZE);

      if (replace) {
        setEvents(incoming);
        if (incoming.length > 0) latestIdRef.current = incoming[0].event_id;
      } else {
        setEvents((prev) => [...prev, ...incoming]);
      }
    } catch {
      setFetchError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getToken, filterSeverity, filterSession]);

  // Initial load and when filters change
  useEffect(() => {
    setOffset(0);
    setEvents([]);
    setHasMore(true);
    void fetchPage(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSeverity, filterSession]);

  // Auto-refresh: poll at top (offset=0), merge new events at top
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void fetchPage(0, true), 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchPage]);

  function loadMore() {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    void fetchPage(next, false);
  }

  return (
    <div style={s.root}>
      {/* Filter bar */}
      <div style={s.filterBar}>
        <select
          style={s.select}
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
        >
          <option value="">All severities</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>

        <input
          style={s.textInput}
          type="text"
          placeholder="Filter by session_id…"
          value={filterSession}
          onChange={(e) => setFilterSession(e.target.value)}
        />

        <label style={s.autoLabel}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          {" "}Auto-refresh
        </label>
      </div>

      {fetchError && <div style={s.fetchError}>Error: {fetchError}</div>}

      {/* Table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {["Severity", "Type", "Session", "Time", "Payload"].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} style={s.emptyCell}>No events found</td>
              </tr>
            ) : (
              events.map((ev, i) => {
                const rowBg = ROW_HIGHLIGHT[ev.severity];
                return (
                  <tr key={ev.event_id ?? i} style={{ ...s.tr, ...(rowBg ?? {}) }}>
                    <td style={s.td}><SeverityChip severity={ev.severity} /></td>
                    <td style={{ ...s.td, ...s.mono, color: "#b0c8f0" }}>{ev.event_type}</td>
                    <td style={{ ...s.td, ...s.mono, color: "#89d" }}>
                      {ev.session_id ? ev.session_id.slice(0, 8) + "…" : "—"}
                    </td>
                    <td style={{ ...s.td, ...s.mono, color: "#777", fontSize: "11px", whiteSpace: "nowrap" as const }}>
                      {fmtTs(ev.created_at)}
                    </td>
                    <td style={s.td}>
                      {ev.payload ? <PayloadCell raw={ev.payload} /> : <span style={s.dimText}>—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && events.length > 0 && (
        <div style={s.loadMoreRow}>
          <button style={{ ...s.loadMoreBtn, ...(loading ? s.loadMoreDisabled : {}) }} onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

const s = {
  root: { padding: "20px", display: "flex", flexDirection: "column" as const, gap: "12px" },
  filterBar: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" as const },
  select: {
    background: "#111", border: "1px solid #444", color: "#ddd",
    borderRadius: "5px", padding: "6px 10px", fontSize: "12px", outline: "none",
  },
  textInput: {
    background: "#111", border: "1px solid #444", color: "#ddd",
    borderRadius: "5px", padding: "6px 10px", fontSize: "12px",
    outline: "none", fontFamily: "monospace", width: "200px",
  },
  autoLabel: { fontSize: "12px", color: "#aaa", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" },
  fetchError: {
    fontSize: "12px", color: "#f44", background: "#1a0000",
    border: "1px solid #5a1111", borderRadius: "4px", padding: "6px 10px",
  },
  tableWrap: { overflowX: "auto" as const },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "12px" },
  th: {
    textAlign: "left" as const, color: "#888", fontSize: "11px", fontWeight: 600,
    letterSpacing: "0.04em", padding: "6px 10px", borderBottom: "1px solid #2a2a2a",
  },
  tr: { borderBottom: "1px solid #1a1a1a" },
  td: { padding: "7px 10px", verticalAlign: "top" as const, color: "#ccc" },
  emptyCell: { padding: "40px", textAlign: "center" as const, color: "#555" },
  mono: { fontFamily: "monospace" },
  dimText: { color: "#555" },
  chip: {
    display: "inline-block", fontSize: "10px", fontWeight: 700,
    padding: "1px 7px", borderRadius: "8px", letterSpacing: "0.05em",
  },
  preOpen: {
    background: "#0d0d0d", border: "1px solid #333", borderRadius: "4px",
    padding: "8px", fontSize: "11px", color: "#ccc", fontFamily: "monospace",
    whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const,
    maxWidth: "500px", overflowX: "auto" as const, cursor: "pointer", margin: 0,
  },
  preCollapsed: {
    fontFamily: "monospace", fontSize: "12px", color: "#99b", cursor: "pointer",
    borderBottom: "1px dashed #445",
  },
  loadMoreRow: { display: "flex", justifyContent: "center", padding: "8px 0" },
  loadMoreBtn: {
    background: "#1a1a2a", border: "1px solid #3a3a5a", color: "#aaf",
    borderRadius: "5px", padding: "8px 24px", fontSize: "12px", cursor: "pointer",
  },
  loadMoreDisabled: { opacity: 0.5, cursor: "not-allowed" as const },
} as const;
