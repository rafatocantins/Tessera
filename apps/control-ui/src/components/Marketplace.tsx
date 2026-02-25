/**
 * Marketplace.tsx — Community skills marketplace browser.
 *
 * Loads on mount, no auto-polling.
 * Shows skill cards with name, author, version, download count, trivy badge.
 * "Install" button per skill with success toast.
 */
import { useState, useEffect, useCallback } from "react";
import { useToken } from "../hooks/useToken.js";

interface MarketplaceSkill {
  skill_id: string;
  version: string;
  name: string;
  description: string;
  author_name: string;
  download_count: number;
  trivy_scan_passed: boolean;
  tags: string[];
}

interface MarketplaceProps {
  secret: string;
}

export function Marketplace({ secret }: MarketplaceProps) {
  const { getToken } = useToken(secret);

  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; error?: boolean }>>([]);
  let toastId = 0;

  const addToast = useCallback((message: string, isError = false) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, error: isError }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (tagFilter) params.set("tag", tagFilter);
      const res = await fetch(`/api/v1/marketplace?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { skills: MarketplaceSkill[] };
      setSkills(data.skills ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, tagFilter]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const installSkill = useCallback(async (skill: MarketplaceSkill) => {
    const key = `${skill.skill_id}@${skill.version}`;
    setInstalling((prev) => new Set(prev).add(key));
    try {
      const token = await getToken();
      const [ns, name] = skill.skill_id.split("/") as [string, string];
      const res = await fetch(
        `/api/v1/marketplace/install/${ns}/${name}/${skill.version}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: "{}",
        }
      );
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      if (!res.ok || !data.success) {
        addToast(data.message ?? data.error ?? "Install failed", true);
        return;
      }
      addToast(`Installed ${skill.name}@${skill.version} — restart agent-runtime to activate`);
      void loadSkills(); // Refresh download count
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [getToken, addToast, loadSkills]);

  // Get all unique tags from loaded skills
  const allTags = [...new Set(skills.flatMap((s) => s.tags))].sort();

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Skills Marketplace</div>
          <div style={s.subtitle}>Community-published, cryptographically verified</div>
        </div>
        <div style={s.skillCount}>{skills.length} skill{skills.length !== 1 ? "s" : ""}</div>
      </div>

      {/* Filters */}
      <div style={s.filters}>
        <input
          type="text"
          placeholder="Search skills…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.searchInput}
        />
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            style={s.tagSelect}
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        )}
        <button style={s.refreshBtn} onClick={() => void loadSkills()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {!loading && skills.length === 0 && !error && (
        <div style={s.empty}>
          <div>No skills found in the marketplace.</div>
          <div style={{ fontSize: "12px", marginTop: "8px", color: "#444" }}>
            Publish a skill with: secureclaw skill publish manifest.json
          </div>
        </div>
      )}

      <div style={s.grid}>
        {skills.map((skill) => {
          const key = `${skill.skill_id}@${skill.version}`;
          const isInstalling = installing.has(key);
          return (
            <div key={key} style={s.card}>
              <div style={s.cardHeader}>
                <div>
                  <div style={s.skillName}>{skill.name}</div>
                  <div style={s.skillId}>{skill.skill_id}</div>
                </div>
                <div style={s.trivyBadge(skill.trivy_scan_passed)}>
                  {skill.trivy_scan_passed ? "✓ Trivy" : "✗ Trivy"}
                </div>
              </div>

              {skill.description && (
                <div style={s.description}>{skill.description}</div>
              )}

              <div style={s.cardMeta}>
                <span style={s.metaItem}>by {skill.author_name}</span>
                <span style={s.metaItem}>v{skill.version}</span>
                <span style={s.metaItem}>↓ {skill.download_count}</span>
              </div>

              {skill.tags.length > 0 && (
                <div style={s.tags}>
                  {skill.tags.map((tag) => (
                    <span key={tag} style={s.tag}>{tag}</span>
                  ))}
                </div>
              )}

              <button
                style={s.installBtn}
                onClick={() => void installSkill(skill)}
                disabled={isInstalling}
              >
                {isInstalling ? "Installing…" : "Install"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Toasts */}
      <div style={s.toastContainer}>
        {toasts.map((toast) => (
          <div key={toast.id} style={s.toast(toast.error ?? false)}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  root: { padding: "20px", maxWidth: "1100px" },
  header: {
    display: "flex", alignItems: "flex-start",
    justifyContent: "space-between", marginBottom: "20px",
  },
  title: { fontSize: "18px", fontWeight: 600, color: "#fff" },
  subtitle: { fontSize: "12px", color: "#666", marginTop: "2px" },
  skillCount: { fontSize: "12px", color: "#555" },
  filters: { display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" as const },
  searchInput: {
    flex: 1, minWidth: "200px", padding: "8px 12px",
    background: "#1e1e1e", border: "1px solid #333", borderRadius: "4px",
    color: "#e0e0e0", fontSize: "13px",
  },
  tagSelect: {
    padding: "8px 10px", background: "#1e1e1e", border: "1px solid #333",
    borderRadius: "4px", color: "#e0e0e0", fontSize: "13px",
  },
  refreshBtn: {
    padding: "8px 16px", background: "transparent", border: "1px solid #444",
    borderRadius: "4px", color: "#ccc", cursor: "pointer", fontSize: "13px",
  },
  error: {
    color: "#f44336", padding: "10px", background: "#1a0000",
    borderRadius: "4px", marginBottom: "12px", fontSize: "13px",
  },
  empty: {
    color: "#555", textAlign: "center" as const,
    padding: "60px 0", fontSize: "14px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "16px",
  },
  card: {
    background: "#141414", border: "1px solid #222",
    borderRadius: "10px", padding: "16px",
    display: "flex", flexDirection: "column" as const, gap: "10px",
  },
  cardHeader: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-start", gap: "8px",
  },
  skillName: { fontSize: "15px", fontWeight: 600, color: "#fff" },
  skillId: { fontSize: "10px", color: "#555", fontFamily: "monospace" },
  trivyBadge: (passed: boolean) => ({
    fontSize: "10px", padding: "3px 8px", borderRadius: "10px",
    fontWeight: 700, flexShrink: 0,
    background: passed ? "#1a3a1a" : "#2a1a00",
    color: passed ? "#4caf50" : "#ff9800",
    border: `1px solid ${passed ? "#4caf50" : "#ff9800"}`,
  }),
  description: { fontSize: "12px", color: "#666", lineHeight: 1.5 },
  cardMeta: { display: "flex", gap: "12px", flexWrap: "wrap" as const },
  metaItem: { fontSize: "11px", color: "#555" },
  tags: { display: "flex", gap: "6px", flexWrap: "wrap" as const },
  tag: {
    fontSize: "10px", padding: "2px 8px", background: "#1a1a2e",
    borderRadius: "10px", color: "#6688cc", border: "1px solid #2a2a4e",
  },
  installBtn: {
    marginTop: "auto", padding: "8px 0", background: "#1e3a1e",
    border: "1px solid #4caf50", borderRadius: "6px",
    color: "#4caf50", cursor: "pointer", fontSize: "13px", fontWeight: 600,
    width: "100%",
  },
  toastContainer: {
    position: "fixed" as const, bottom: "20px", right: "20px",
    display: "flex", flexDirection: "column" as const, gap: "8px",
    zIndex: 1000, maxWidth: "400px",
  },
  toast: (isError: boolean) => ({
    padding: "12px 16px", borderRadius: "8px", fontSize: "13px",
    background: isError ? "#2a0a0a" : "#0a2a0a",
    border: `1px solid ${isError ? "#f44336" : "#4caf50"}`,
    color: isError ? "#f44336" : "#4caf50",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  }),
} as const;
