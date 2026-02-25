/**
 * ComplianceDashboard.tsx — EU AI Act compliance evidence viewer.
 *
 * Shows per-article status cards (COMPLIANT/WARNING) with evidence JSON.
 * Supports date range picker + JSON export for auditors.
 * No auto-polling — compliance reports are heavy; user triggers manually.
 */
import { useState, useCallback } from "react";
import { useToken } from "../hooks/useToken.js";

interface ArticleStatus {
  article_id: string;
  status: string;
  summary: string;
  evidence_json: string;
}

interface ComplianceReport {
  generated_at_iso: string;
  framework_version: string;
  overall_status: string;
  articles: ArticleStatus[];
  issues: string[];
}

interface ComplianceDashboardProps {
  secret: string;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ComplianceDashboard({ secret }: ComplianceDashboardProps) {
  const { getToken } = useToken(secret);

  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(formatDate(defaultFrom));
  const [toDate, setToDate] = useState(formatDate(defaultTo));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const fromMs = new Date(fromDate).getTime();
      const toMs = new Date(toDate).getTime() + 86_400_000; // include full end day
      const res = await fetch(
        `/api/v1/compliance/report?from=${fromMs}&to=${toMs}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json() as ComplianceReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [getToken, fromDate, toDate]);

  const exportReport = useCallback(async () => {
    try {
      const token = await getToken();
      const fromMs = new Date(fromDate).getTime();
      const toMs = new Date(toDate).getTime() + 86_400_000;
      const res = await fetch(
        `/api/v1/compliance/report/export?from=${fromMs}&to=${toMs}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "eu-ai-act-report.json";
      a.click();
    } catch { /* ignore */ }
  }, [getToken, fromDate, toDate]);

  const copyToClipboard = useCallback(async () => {
    if (!report) return;
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [report]);

  const toggleExpand = (articleId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(articleId)) next.delete(articleId);
      else next.add(articleId);
      return next;
    });
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.title}>EU AI Act Compliance</div>
          <div style={s.subtitle}>EU AI Act 2024/1689 — Evidence Report</div>
        </div>
        {report && (
          <div style={s.overallBadge(report.overall_status)}>
            {report.overall_status}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={s.controls}>
        <label style={s.label}>
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={s.dateInput}
          />
        </label>
        <label style={s.label}>
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={s.dateInput}
          />
        </label>
        <button style={s.btn} onClick={() => void loadReport()} disabled={loading}>
          {loading ? "Loading…" : "Generate Report"}
        </button>
        {report && (
          <>
            <button style={s.btnSecondary} onClick={() => void exportReport()}>
              Export JSON
            </button>
            <button style={s.btnSecondary} onClick={() => void copyToClipboard()}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </>
        )}
      </div>

      {error && <div style={s.error}>{error}</div>}

      {report && (
        <>
          <div style={s.meta}>
            Generated {new Date(report.generated_at_iso).toLocaleString()} ·{" "}
            {report.framework_version}
          </div>

          {report.issues.length > 0 && (
            <div style={s.issuesBanner}>
              <strong>Issues:</strong>
              <ul style={{ margin: "4px 0 0 0", paddingLeft: "18px" }}>
                {report.issues.map((issue, i) => (
                  <li key={i} style={{ fontSize: "12px" }}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={s.articleGrid}>
            {report.articles.map((article) => {
              const isExp = expanded.has(article.article_id);
              let evidenceParsed: unknown = article.evidence_json;
              try { evidenceParsed = JSON.parse(article.evidence_json); } catch { /* use raw */ }
              return (
                <div key={article.article_id} style={s.articleCard(article.status)}>
                  <div style={s.articleHeader}>
                    <div>
                      <div style={s.articleId}>
                        {article.article_id.replace(/_/g, " ")}
                      </div>
                      <div style={s.articleSummary}>{article.summary}</div>
                    </div>
                    <div style={s.articleBadge(article.status)}>{article.status}</div>
                  </div>
                  <button
                    style={s.evidenceToggle}
                    onClick={() => toggleExpand(article.article_id)}
                  >
                    {isExp ? "Hide evidence ▲" : "Show evidence ▼"}
                  </button>
                  {isExp && (
                    <pre style={s.evidenceJson}>
                      {JSON.stringify(evidenceParsed, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {!report && !loading && !error && (
        <div style={s.empty}>
          Select a date range and click "Generate Report" to view compliance evidence.
        </div>
      )}
    </div>
  );
}

const s = {
  root: { padding: "20px", maxWidth: "900px" },
  header: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    marginBottom: "20px",
  },
  title: { fontSize: "18px", fontWeight: 600, color: "#fff" },
  subtitle: { fontSize: "12px", color: "#666", marginTop: "2px" },
  overallBadge: (status: string) => ({
    padding: "6px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: 700,
    background: status === "COMPLIANT" ? "#1a3a1a" : "#3a2a00",
    color: status === "COMPLIANT" ? "#4caf50" : "#ff9800",
    border: `1px solid ${status === "COMPLIANT" ? "#4caf50" : "#ff9800"}`,
  }),
  controls: {
    display: "flex", gap: "12px", alignItems: "flex-end",
    marginBottom: "16px", flexWrap: "wrap" as const,
  },
  label: {
    display: "flex", flexDirection: "column" as const,
    gap: "4px", fontSize: "11px", color: "#888",
  },
  dateInput: {
    background: "#1e1e1e", border: "1px solid #333", borderRadius: "4px",
    color: "#e0e0e0", padding: "6px 8px", fontSize: "12px",
  },
  btn: {
    padding: "8px 16px", background: "#4caf50", border: "none", borderRadius: "4px",
    color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 600,
  },
  btnSecondary: {
    padding: "8px 16px", background: "transparent", border: "1px solid #444",
    borderRadius: "4px", color: "#ccc", cursor: "pointer", fontSize: "13px",
  },
  error: {
    color: "#f44336", padding: "10px", background: "#1a0000",
    borderRadius: "4px", marginBottom: "12px", fontSize: "13px",
  },
  meta: { fontSize: "11px", color: "#555", marginBottom: "16px" },
  issuesBanner: {
    padding: "12px 16px", background: "#2a1a00", border: "1px solid #ff9800",
    borderRadius: "6px", marginBottom: "16px", color: "#ff9800", fontSize: "13px",
  },
  articleGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" },
  articleCard: (status: string) => ({
    background: "#141414",
    border: `1px solid ${status === "COMPLIANT" ? "#1a3a1a" : "#3a2a00"}`,
    borderRadius: "8px", padding: "16px",
  }),
  articleHeader: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-start", gap: "8px",
  },
  articleId: {
    fontSize: "13px", fontWeight: 600, color: "#ccc",
    textTransform: "capitalize" as const,
  },
  articleSummary: { fontSize: "11px", color: "#666", marginTop: "4px" },
  articleBadge: (status: string) => ({
    padding: "3px 8px", borderRadius: "12px",
    fontSize: "10px", fontWeight: 700, flexShrink: 0,
    background: status === "COMPLIANT" ? "#1a3a1a" : "#3a2a00",
    color: status === "COMPLIANT" ? "#4caf50" : "#ff9800",
  }),
  evidenceToggle: {
    marginTop: "10px", background: "none", border: "none",
    cursor: "pointer", color: "#555", fontSize: "11px", padding: "0",
  },
  evidenceJson: {
    marginTop: "8px", padding: "10px", background: "#0a0a0a",
    borderRadius: "4px", fontSize: "10px", color: "#6a9955",
    overflowX: "auto" as const, maxHeight: "200px", overflowY: "auto" as const,
  },
  empty: {
    color: "#555", textAlign: "center" as const,
    padding: "60px 0", fontSize: "14px",
  },
} as const;
