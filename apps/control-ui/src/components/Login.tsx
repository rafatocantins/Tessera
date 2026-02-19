/**
 * Login.tsx — HMAC secret entry screen.
 *
 * The user pastes their GATEWAY_HMAC_SECRET here. The secret is stored only
 * in React state (never localStorage / sessionStorage). On submit we verify
 * it works by generating a fresh token and hitting GET /health.
 */
import { useState, type FormEvent } from "react";
import { useToken } from "../hooks/useToken.js";

interface LoginProps {
  onLogin: (secret: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getToken } = useToken(secret);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      const res = await fetch("/health", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError(`Gateway returned ${res.status} — check the secret.`);
        return;
      }
      onLogin(secret.trim());
    } catch {
      setError("Cannot reach the gateway. Is it running on port 18789?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.overlay}>
      <form style={s.card} onSubmit={(e) => void handleSubmit(e)}>
        <h1 style={s.title}>SecureClaw</h1>
        <p style={s.subtitle}>Control UI — enter your gateway secret to continue</p>

        <label style={s.label} htmlFor="secret">
          GATEWAY_HMAC_SECRET
        </label>
        <input
          id="secret"
          style={s.input}
          type="password"
          autoComplete="off"
          autoFocus
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            setError(null);
          }}
          placeholder="Paste secret here…"
          disabled={loading}
        />

        {error && <p style={s.error}>{error}</p>}

        <button style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }} type="submit" disabled={loading}>
          {loading ? "Verifying…" : "Connect"}
        </button>
      </form>
    </div>
  );
}

const s = {
  overlay: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "#0f0f0f",
  },
  card: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "10px",
    padding: "32px 36px",
    width: "340px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
  },
  title: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#fff",
    margin: 0,
    textAlign: "center" as const,
  },
  subtitle: {
    fontSize: "12px",
    color: "#888",
    margin: "0 0 4px",
    textAlign: "center" as const,
  },
  label: {
    fontSize: "11px",
    color: "#aaa",
    letterSpacing: "0.05em",
    fontFamily: "monospace",
  },
  input: {
    background: "#111",
    border: "1px solid #444",
    borderRadius: "6px",
    color: "#e0e0e0",
    fontSize: "14px",
    padding: "9px 12px",
    outline: "none",
    fontFamily: "monospace",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  error: {
    fontSize: "12px",
    color: "#f44",
    margin: 0,
    background: "#2a1111",
    border: "1px solid #5a2222",
    borderRadius: "4px",
    padding: "6px 10px",
  },
  btn: {
    background: "#2a5a2a",
    border: "1px solid #4a8a4a",
    borderRadius: "6px",
    color: "#cfc",
    fontSize: "14px",
    padding: "10px",
    cursor: "pointer",
    fontWeight: 600,
    marginTop: "4px",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed" as const,
  },
} as const;
