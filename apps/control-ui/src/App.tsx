/**
 * App.tsx — SecureClaw Control UI root.
 *
 * State machine:
 *  - secret === null → <Login> screen
 *  - secret !== null → three-tab dashboard (Approvals, Sessions, Audit Log)
 *
 * The HMAC secret lives only in React state; never localStorage/sessionStorage.
 */
import { useState } from "react";
import { Login } from "./components/Login.js";
import { ApprovalQueue } from "./components/ApprovalQueue.js";
import { SessionList } from "./components/SessionList.js";
import { AuditLog } from "./components/AuditLog.js";
import { CredentialVault } from "./components/CredentialVault.js";

type Tab = "approvals" | "sessions" | "audit" | "credentials";

export function App() {
  const [secret, setSecret] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("approvals");
  const [pendingCount, setPendingCount] = useState(0);

  if (!secret) {
    return <Login onLogin={(s) => setSecret(s)} />;
  }

  return (
    <div style={s.root}>
      {/* Top bar */}
      <header style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.brand}>SecureClaw</span>
          <span style={s.brandSub}>Control UI</span>
        </div>

        <nav style={s.nav}>
          <TabBtn
            active={tab === "approvals"}
            onClick={() => setTab("approvals")}
            badge={pendingCount > 0 ? pendingCount : undefined}
          >
            Approvals
          </TabBtn>
          <TabBtn active={tab === "sessions"} onClick={() => setTab("sessions")}>
            Sessions
          </TabBtn>
          <TabBtn active={tab === "audit"} onClick={() => setTab("audit")}>
            Audit Log
          </TabBtn>
          <TabBtn active={tab === "credentials"} onClick={() => setTab("credentials")}>
            Credentials
          </TabBtn>
        </nav>

        <div style={s.headerRight}>
          <span style={s.userLabel}>control-ui</span>
          <button
            style={s.logoutBtn}
            onClick={() => {
              setSecret(null);
              setPendingCount(0);
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Content */}
      <main style={s.main}>
        {tab === "approvals" && (
          <ApprovalQueue
            secret={secret}
            onCountChange={setPendingCount}
          />
        )}
        {tab === "sessions" && <SessionList secret={secret} />}
        {tab === "audit" && <AuditLog secret={secret} />}
        {tab === "credentials" && <CredentialVault secret={secret} />}
      </main>
    </div>
  );
}

interface TabBtnProps {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}

function TabBtn({ active, onClick, badge, children }: TabBtnProps) {
  return (
    <button
      style={{ ...s.tabBtn, ...(active ? s.tabBtnActive : {}) }}
      onClick={onClick}
    >
      {children}
      {badge !== undefined && (
        <span style={s.badge}>{badge > 99 ? "99+" : badge}</span>
      )}
    </button>
  );
}

const s = {
  root: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: "#0f0f0f",
    color: "#e0e0e0",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    padding: "0 20px",
    background: "#141414",
    borderBottom: "1px solid #2a2a2a",
    display: "flex",
    alignItems: "center",
    gap: "20px",
    height: "48px",
    flexShrink: 0,
  },
  headerLeft: { display: "flex", alignItems: "baseline", gap: "8px" },
  brand: { fontSize: "16px", fontWeight: 700, color: "#fff" },
  brandSub: { fontSize: "11px", color: "#666" },
  nav: { display: "flex", gap: "2px", flex: 1 },
  headerRight: { display: "flex", alignItems: "center", gap: "12px" },
  userLabel: { fontSize: "12px", color: "#555", fontFamily: "monospace" },
  logoutBtn: {
    fontSize: "11px", padding: "4px 10px", cursor: "pointer",
    background: "transparent", border: "1px solid #333", borderRadius: "4px",
    color: "#888",
  },
  tabBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    color: "#888", fontSize: "13px", padding: "0 14px",
    height: "48px", borderBottom: "2px solid transparent",
    display: "flex", alignItems: "center", gap: "6px",
    transition: "color 0.1s",
  },
  tabBtnActive: {
    color: "#fff",
    borderBottom: "2px solid #4caf50",
  },
  badge: {
    fontSize: "10px", fontWeight: 700,
    background: "#c0392b", color: "#fff",
    borderRadius: "10px", padding: "1px 5px",
    lineHeight: "1.4",
  },
  main: { flex: 1, overflowY: "auto" as const },
} as const;
