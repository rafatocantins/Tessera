/**
 * SecureClaw Control UI — Phase 2 scaffold.
 *
 * This is a minimal placeholder. Phase 2 will add:
 * - Session management dashboard
 * - Real-time cost tracking
 * - Audit log viewer (streaming)
 * - Tool approval queue
 * - Agent status monitoring
 * - Credential management (read-only: create/revoke, never display)
 */

const GATEWAY_URL = "http://127.0.0.1:18789";

export function App() {
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>SecureClaw</h1>
        <span style={styles.badge}>Control UI · Phase 2</span>
      </header>

      <main style={styles.main}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Status</h2>
          <p style={styles.cardBody}>
            Phase 2 Control UI scaffold. The gateway is expected at{" "}
            <code style={styles.code}>{GATEWAY_URL}</code>.
          </p>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Quick Links</h2>
          <ul style={styles.list}>
            <li>
              <a style={styles.link} href={`${GATEWAY_URL}/health`} target="_blank" rel="noreferrer">
                Gateway health check
              </a>
            </li>
            <li>
              <a style={styles.link} href="/api/v1/sessions" target="_blank" rel="noreferrer">
                Sessions API
              </a>
            </li>
          </ul>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Browser WebChat (Phase 1)</h2>
          <p style={styles.cardBody}>
            For Phase 1 testing, use the static WebChat client served by the gateway.
          </p>
        </div>
      </main>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: "#0f0f0f",
    color: "#e0e0e0",
    minHeight: "100vh",
  },
  header: {
    padding: "12px 24px",
    background: "#1a1a1a",
    borderBottom: "1px solid #333",
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#fff",
    margin: 0,
  },
  badge: {
    fontSize: "11px",
    padding: "2px 8px",
    borderRadius: "12px",
    background: "#1a3a1a",
    color: "#4caf50",
  },
  main: {
    padding: "24px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
    maxWidth: "640px",
  },
  card: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "8px",
    padding: "16px 20px",
  },
  cardTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#fff",
    margin: "0 0 8px",
  },
  cardBody: {
    fontSize: "13px",
    color: "#aaa",
    margin: 0,
    lineHeight: 1.6,
  },
  code: {
    background: "#111",
    border: "1px solid #333",
    borderRadius: "4px",
    padding: "1px 6px",
    fontFamily: "monospace",
    fontSize: "12px",
    color: "#89d",
  },
  list: {
    fontSize: "13px",
    color: "#aaa",
    margin: 0,
    paddingLeft: "20px",
    lineHeight: 2,
  },
  link: {
    color: "#89d",
    textDecoration: "none",
  },
} as const;
