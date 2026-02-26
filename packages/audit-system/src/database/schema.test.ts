import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "./schema.js";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initSchema(db);
  return db;
}

// ──────────────────────────────────────────────────────────────────────────────
// audit_events — fully append-only
// ──────────────────────────────────────────────────────────────────────────────
describe("audit_events — append-only enforcement", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = makeDb();
    db.prepare(
      "INSERT INTO audit_events (event_type, payload, severity, created_at) VALUES (?, ?, ?, ?)"
    ).run("TEST_EVENT", JSON.stringify({ test: true }), "INFO", Date.now());
  });

  it("allows INSERT into audit_events", () => {
    const count = (db.prepare("SELECT COUNT(*) as c FROM audit_events").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it("blocks UPDATE on audit_events", () => {
    expect(() => {
      db.prepare("UPDATE audit_events SET severity = 'ERROR' WHERE id = 1").run();
    }).toThrow(/audit_events is append-only: UPDATE not permitted/);
  });

  it("blocks DELETE on audit_events", () => {
    expect(() => {
      db.prepare("DELETE FROM audit_events WHERE id = 1").run();
    }).toThrow(/audit_events is append-only: DELETE not permitted/);
  });

  it("blocks DELETE with no WHERE clause (bulk delete)", () => {
    expect(() => {
      db.prepare("DELETE FROM audit_events").run();
    }).toThrow(/audit_events is append-only: DELETE not permitted/);
  });

  it("enforces json_valid constraint on payload", () => {
    expect(() => {
      db.prepare(
        "INSERT INTO audit_events (event_type, payload, severity, created_at) VALUES (?, ?, ?, ?)"
      ).run("BAD", "not-json", "INFO", Date.now());
    }).toThrow();
  });

  it("enforces CHECK constraint on severity", () => {
    expect(() => {
      db.prepare(
        "INSERT INTO audit_events (event_type, payload, severity, created_at) VALUES (?, ?, ?, ?)"
      ).run("BAD", "{}", "DEBUG", Date.now()); // 'DEBUG' is not in the allowed set
    }).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// sessions — allows UPDATE (for cost accumulation), blocks DELETE
// ──────────────────────────────────────────────────────────────────────────────
describe("sessions — append-only enforcement (no delete, update allowed)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = makeDb();
    db.prepare(
      "INSERT INTO sessions (id, user_id, provider, started_at) VALUES (?, ?, ?, ?)"
    ).run("sess-1", "user-1", "anthropic", Date.now());
  });

  it("allows INSERT into sessions", () => {
    const count = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it("allows UPDATE on sessions (for cost accumulation)", () => {
    expect(() => {
      db.prepare(
        "UPDATE sessions SET total_cost_usd = 1.23, ended_at = ? WHERE id = 'sess-1'"
      ).run(Date.now());
    }).not.toThrow();

    const row = db.prepare("SELECT total_cost_usd FROM sessions WHERE id = 'sess-1'").get() as {
      total_cost_usd: number;
    };
    expect(row.total_cost_usd).toBe(1.23);
  });

  it("blocks DELETE on sessions", () => {
    expect(() => {
      db.prepare("DELETE FROM sessions WHERE id = 'sess-1'").run();
    }).toThrow(/sessions is append-only: DELETE not permitted/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// alerts — allows UPDATE (for acknowledgment), blocks DELETE
// ──────────────────────────────────────────────────────────────────────────────
describe("alerts — append-only enforcement (no delete, acknowledgment allowed)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = makeDb();
    db.prepare(
      "INSERT INTO alerts (rule_id, severity, message, created_at, acknowledged) VALUES (?, ?, ?, ?, 0)"
    ).run("INJECTION_DETECTED", "CRITICAL", "injection attempt", Date.now());
  });

  it("allows INSERT into alerts", () => {
    const count = (db.prepare("SELECT COUNT(*) as c FROM alerts").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it("allows UPDATE acknowledged = 1 on alerts", () => {
    expect(() => {
      db.prepare("UPDATE alerts SET acknowledged = 1 WHERE id = 1").run();
    }).not.toThrow();

    const row = db.prepare("SELECT acknowledged FROM alerts WHERE id = 1").get() as {
      acknowledged: number;
    };
    expect(row.acknowledged).toBe(1);
  });

  it("blocks DELETE on alerts", () => {
    expect(() => {
      db.prepare("DELETE FROM alerts WHERE id = 1").run();
    }).toThrow(/alerts is append-only: DELETE not permitted/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// cost_ledger — fully append-only
// ──────────────────────────────────────────────────────────────────────────────
describe("cost_ledger — append-only enforcement", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = makeDb();
    db.prepare(
      "INSERT INTO cost_ledger (session_id, user_id, provider, model, input_tokens, output_tokens, cost_usd, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("sess-1", "user-1", "anthropic", "claude-3-5-haiku-20241022", 100, 200, 0.0012, Date.now());
  });

  it("allows INSERT into cost_ledger", () => {
    const count = (db.prepare("SELECT COUNT(*) as c FROM cost_ledger").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it("blocks UPDATE on cost_ledger", () => {
    expect(() => {
      db.prepare("UPDATE cost_ledger SET cost_usd = 0 WHERE id = 1").run();
    }).toThrow(/cost_ledger is append-only: UPDATE not permitted/);
  });

  it("blocks DELETE on cost_ledger", () => {
    expect(() => {
      db.prepare("DELETE FROM cost_ledger WHERE id = 1").run();
    }).toThrow(/cost_ledger is append-only: DELETE not permitted/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Schema integrity — multiple rows, indexes exist
// ──────────────────────────────────────────────────────────────────────────────
describe("schema integrity", () => {
  it("initSchema is idempotent (can be called twice)", () => {
    const db = makeDb();
    expect(() => initSchema(db)).not.toThrow();
  });

  it("indexes are created on audit_events", () => {
    const db = makeDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_events'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_events_session");
    expect(names).toContain("idx_events_type");
    expect(names).toContain("idx_events_created");
    expect(names).toContain("idx_events_severity");
  });

  it("inserting multiple audit_events gets sequential IDs", () => {
    const db = makeDb();
    const stmt = db.prepare(
      "INSERT INTO audit_events (event_type, payload, severity, created_at) VALUES (?, ?, ?, ?)"
    );
    stmt.run("EVT_A", "{}", "INFO", Date.now());
    stmt.run("EVT_B", "{}", "WARN", Date.now());
    stmt.run("EVT_C", "{}", "ERROR", Date.now());

    const rows = db.prepare("SELECT id, event_type FROM audit_events ORDER BY id").all() as {
      id: number;
      event_type: string;
    }[];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.id).toBe(1);
    expect(rows[1]!.id).toBe(2);
    expect(rows[2]!.id).toBe(3);
  });
});
