/**
 * CredentialVault.tsx — Credential management tab.
 *
 * SECURITY: Values are WRITE-ONLY. The OS keychain stores them; the UI never
 * displays a stored value. The POST response only contains { ref_id, service, account }.
 *
 * Operations:
 * - List credentials (GET /api/v1/credentials)
 * - Add credential via modal (POST /api/v1/credentials)
 * - Revoke credential (DELETE /api/v1/credentials/:service/:account)
 */
import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useToken } from "../hooks/useToken.js";

interface SecretRef {
  ref_id: string;
  service: string;
  account: string;
  created_at: string;
}

interface CredentialVaultProps {
  secret: string;
}

function fmtRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const EMPTY_FORM = { service: "", account: "", value: "" };

export function CredentialVault({ secret }: CredentialVaultProps) {
  const [creds, setCreds] = useState<SecretRef[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const { getToken } = useToken(secret);

  const fetchCreds = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/v1/credentials", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { credentials: SecretRef[] };
      setCreds(data.credentials ?? []);
      setFetchError(null);
    } catch {
      setFetchError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchCreds();
  }, [fetchCreds]);

  async function handleRevoke(cred: SecretRef) {
    if (!window.confirm(`Revoke credential "${cred.service} / ${cred.account}"? This cannot be undone.`)) return;
    const key = `${cred.service}:${cred.account}`;
    setDeleting((prev) => new Set(prev).add(key));
    // Optimistic remove
    setCreds((prev) => prev.filter((c) => !(c.service === cred.service && c.account === cred.account)));
    try {
      const token = await getToken();
      await fetch(`/api/v1/credentials/${encodeURIComponent(cred.service)}/${encodeURIComponent(cred.account)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best effort — refresh will correct the list
      void fetchCreds();
    } finally {
      setDeleting((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.service.trim() || !form.account.trim() || !form.value) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/v1/credentials", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ service: form.service.trim(), account: form.account.trim(), value: form.value }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setSubmitError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { ref_id: string; service: string; account: string };
      setSubmitSuccess(`Stored. ref_id: ${data.ref_id}`);
      setForm(EMPTY_FORM);
      // Refresh list after short delay so success message is visible
      setTimeout(() => {
        setShowModal(false);
        setSubmitSuccess(null);
        void fetchCreds();
      }, 1200);
    } catch {
      setSubmitError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  function closeModal() {
    setShowModal(false);
    setForm(EMPTY_FORM);
    setSubmitError(null);
    setSubmitSuccess(null);
  }

  return (
    <div style={s.root}>
      {/* Security notice — always visible */}
      <div style={s.notice}>
        ⚠ Stored credentials are write-only. Values are kept in the OS keychain and are
        never transmitted back to this UI.
      </div>

      {/* Header row */}
      <div style={s.headerRow}>
        <span style={s.heading}>Vault Credentials</span>
        <div style={s.headerActions}>
          <button style={s.refreshBtn} onClick={() => void fetchCreds()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button style={s.addBtn} onClick={() => setShowModal(true)}>
            + Add Credential
          </button>
        </div>
      </div>

      {fetchError && <div style={s.fetchError}>Error: {fetchError}</div>}

      {/* Credential table */}
      {creds.length === 0 && !loading && !fetchError ? (
        <div style={s.empty}>
          No credentials stored. Use <strong>Add Credential</strong> to store an API key or secret.
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {["Service", "Account", "Ref ID", "Added", ""].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => {
                const key = `${c.service}:${c.account}`;
                const busy = deleting.has(key);
                return (
                  <tr key={c.ref_id} style={{ ...s.tr, ...(busy ? s.trDeleting : {}) }}>
                    <td style={{ ...s.td, fontWeight: 600, color: "#e0e0e0" }}>{c.service}</td>
                    <td style={{ ...s.td, fontFamily: "monospace" }}>{c.account}</td>
                    <td style={{ ...s.td, fontFamily: "monospace", color: "#89d", fontSize: "11px" }}>
                      {c.ref_id.slice(0, 8)}…{c.ref_id.slice(-4)}
                    </td>
                    <td style={{ ...s.td, color: "#666", fontSize: "12px" }}>
                      {fmtRelative(c.created_at)}
                    </td>
                    <td style={s.td}>
                      <button
                        style={{ ...s.revokeBtn, ...(busy ? s.revokeBtnDisabled : {}) }}
                        disabled={busy}
                        onClick={() => void handleRevoke(c)}
                      >
                        {busy ? "…" : "Revoke"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Credential Modal */}
      {showModal && (
        <div style={s.modalOverlay} onClick={closeModal}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Add Credential</span>
              <button style={s.modalClose} onClick={closeModal}>✕</button>
            </div>

            <p style={s.modalNote}>
              The secret value is transmitted once over HTTPS and stored in the OS keychain.
              It cannot be retrieved or displayed after this point.
            </p>

            <form onSubmit={(e) => void handleSubmit(e)} style={s.form}>
              <label style={s.label}>Service
                <input
                  style={s.input}
                  type="text"
                  placeholder="e.g. anthropic"
                  autoComplete="off"
                  value={form.service}
                  onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
                  disabled={submitting}
                  required
                />
              </label>

              <label style={s.label}>Account
                <input
                  style={s.input}
                  type="text"
                  placeholder="e.g. api_key"
                  autoComplete="off"
                  value={form.account}
                  onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
                  disabled={submitting}
                  required
                />
              </label>

              <label style={s.label}>Secret value
                <input
                  style={s.input}
                  type="password"
                  placeholder="Paste secret here…"
                  autoComplete="new-password"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  disabled={submitting}
                  required
                />
              </label>

              {submitError && <div style={s.submitError}>{submitError}</div>}
              {submitSuccess && <div style={s.submitSuccess}>{submitSuccess}</div>}

              <div style={s.formActions}>
                <button type="button" style={s.cancelBtn} onClick={closeModal} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ ...s.storeBtn, ...(submitting ? s.storeBtnDisabled : {}) }}
                  disabled={submitting || !form.service || !form.account || !form.value}
                >
                  {submitting ? "Storing…" : "Store Credential"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  root: { padding: "20px", display: "flex", flexDirection: "column" as const, gap: "14px" },
  notice: {
    fontSize: "12px", color: "#c8a020", background: "#1e1800",
    border: "1px solid #4a3800", borderRadius: "5px", padding: "8px 12px",
  },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: "14px", fontWeight: 600, color: "#e0e0e0" },
  headerActions: { display: "flex", gap: "8px" },
  refreshBtn: {
    fontSize: "12px", padding: "5px 12px", cursor: "pointer",
    background: "#1a1a2a", border: "1px solid #3a3a5a", color: "#aaa",
    borderRadius: "4px",
  },
  addBtn: {
    fontSize: "12px", padding: "5px 14px", cursor: "pointer",
    background: "#1a3a1a", border: "1px solid #3a6a3a", color: "#cfc",
    borderRadius: "4px", fontWeight: 600,
  },
  fetchError: {
    fontSize: "12px", color: "#f44", background: "#1a0000",
    border: "1px solid #5a1111", borderRadius: "4px", padding: "6px 10px",
  },
  empty: {
    color: "#666", fontSize: "13px", padding: "50px 0", textAlign: "center" as const,
  },
  tableWrap: { overflowX: "auto" as const },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: {
    textAlign: "left" as const, color: "#888", fontSize: "11px", fontWeight: 600,
    letterSpacing: "0.04em", padding: "6px 10px", borderBottom: "1px solid #2a2a2a",
  },
  tr: { borderBottom: "1px solid #1e1e1e" },
  trDeleting: { opacity: 0.4 },
  td: { padding: "10px 10px", verticalAlign: "middle" as const, color: "#ccc" },
  revokeBtn: {
    fontSize: "11px", padding: "4px 10px", cursor: "pointer",
    background: "#2a1a1a", color: "#f88", border: "1px solid #5a2a2a",
    borderRadius: "4px",
  },
  revokeBtnDisabled: { opacity: 0.4, cursor: "not-allowed" as const },

  // Modal
  modalOverlay: {
    position: "fixed" as const, inset: 0,
    background: "rgba(0,0,0,0.7)", backdropFilter: "blur(2px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#1a1a1a", border: "1px solid #3a3a3a", borderRadius: "10px",
    padding: "24px 28px", width: "400px", display: "flex",
    flexDirection: "column" as const, gap: "14px",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: "15px", fontWeight: 700, color: "#fff" },
  modalClose: {
    background: "transparent", border: "none", color: "#888",
    fontSize: "16px", cursor: "pointer", padding: "2px 6px",
  },
  modalNote: {
    fontSize: "12px", color: "#a0822a", background: "#1e1600",
    border: "1px solid #3a2a00", borderRadius: "4px", padding: "8px 10px",
    margin: 0, lineHeight: 1.5,
  },
  form: { display: "flex", flexDirection: "column" as const, gap: "10px" },
  label: {
    fontSize: "11px", color: "#aaa", letterSpacing: "0.04em",
    display: "flex", flexDirection: "column" as const, gap: "4px",
  },
  input: {
    background: "#111", border: "1px solid #444", borderRadius: "5px",
    color: "#e0e0e0", fontSize: "13px", padding: "8px 10px",
    outline: "none", fontFamily: "monospace",
  },
  submitError: {
    fontSize: "12px", color: "#f44", background: "#1a0000",
    border: "1px solid #5a1111", borderRadius: "4px", padding: "6px 10px",
  },
  submitSuccess: {
    fontSize: "12px", color: "#4f4", background: "#001a00",
    border: "1px solid #1a5a1a", borderRadius: "4px", padding: "6px 10px",
    fontFamily: "monospace",
  },
  formActions: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" },
  cancelBtn: {
    fontSize: "13px", padding: "8px 16px", cursor: "pointer",
    background: "transparent", border: "1px solid #444", color: "#888", borderRadius: "5px",
  },
  storeBtn: {
    fontSize: "13px", fontWeight: 600, padding: "8px 20px", cursor: "pointer",
    background: "#1a4a1a", border: "1px solid #3a7a3a", color: "#cfc", borderRadius: "5px",
  },
  storeBtnDisabled: { opacity: 0.4, cursor: "not-allowed" as const },
} as const;
