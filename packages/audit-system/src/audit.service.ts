/**
 * audit.service.ts — Core audit service implementation.
 *
 * All log writes are synchronous (better-sqlite3) to ensure durability.
 * Alert rules are evaluated after every write.
 */
import type Database from "better-sqlite3";
import { nowUtcMs } from "@secureclaw/shared";
import type { AuditEvent, AuditSeverity } from "@secureclaw/shared";
import { ALERT_RULES, type AlertContext, type AlertFinding } from "./alert-rules.js";

export interface LogEventParams {
  event_type: string;
  session_id?: string;
  user_id?: string;
  payload: Record<string, unknown>;
  severity: AuditSeverity;
}

export interface LogEventResult {
  event_id: number;
  success: boolean;
  alerts_triggered: AlertFinding[];
}

export interface CostSummaryResult {
  total_cost_usd: number;
  cap_usd: number;
  remaining_usd: number;
  cap_exceeded: boolean;
  cost_by_model: Record<string, number>;
}

export class AuditService {
  private db: Database.Database;
  private costCapUsd: number;

  // Prepared statements (created once for performance)
  private stmtInsertEvent!: Database.Statement;
  private stmtInsertAlert!: Database.Statement;
  private stmtUpdateSession!: Database.Statement;

  constructor(db: Database.Database, costCapUsd = 5.0) {
    this.db = db;
    this.costCapUsd = costCapUsd;
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmtInsertEvent = this.db.prepare(
      "INSERT INTO audit_events (event_type, session_id, user_id, payload, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    this.stmtInsertAlert = this.db.prepare(
      "INSERT INTO alerts (rule_id, severity, session_id, message, context, created_at, acknowledged) VALUES (?, ?, ?, ?, ?, ?, 0)"
    );
    this.stmtUpdateSession = this.db.prepare(
      "INSERT OR IGNORE INTO sessions (id, user_id, provider, started_at) VALUES (?, ?, 'unknown', ?)"
    );
  }

  logEvent(params: LogEventParams): LogEventResult {
    const now = nowUtcMs();
    const payloadJson = JSON.stringify(params.payload);

    // Write is synchronous — ensures durability before returning
    const result = this.stmtInsertEvent.run(
      params.event_type,
      params.session_id ?? null,
      params.user_id ?? null,
      payloadJson,
      params.severity,
      now
    );

    const event_id = Number(result.lastInsertRowid);

    // Build the AuditEvent for rule evaluation
    const event: AuditEvent = {
      id: event_id,
      event_type: params.event_type as AuditEvent["event_type"],
      session_id: params.session_id,
      user_id: params.user_id,
      payload: params.payload,
      severity: params.severity,
      created_at_unix_ms: now,
    };

    // Evaluate alert rules
    const ctx = this.buildAlertContext(params.session_id);
    const alerts_triggered: AlertFinding[] = [];

    for (const rule of ALERT_RULES) {
      const finding = rule.evaluate(event, ctx);
      if (finding) {
        this.stmtInsertAlert.run(
          finding.rule_id,
          finding.severity,
          params.session_id ?? null,
          finding.message,
          JSON.stringify(finding.context),
          now
        );
        alerts_triggered.push(finding);
      }
    }

    return { event_id, success: true, alerts_triggered };
  }

  queryEvents(params: {
    session_id?: string;
    from_unix_ms?: number;
    to_unix_ms?: number;
    event_types?: string[];
    limit?: number;
  }): AuditEvent[] {
    let sql = "SELECT * FROM audit_events WHERE 1=1";
    const args: unknown[] = [];

    if (params.session_id) {
      sql += " AND session_id = ?";
      args.push(params.session_id);
    }
    if (params.from_unix_ms) {
      sql += " AND created_at >= ?";
      args.push(params.from_unix_ms);
    }
    if (params.to_unix_ms) {
      sql += " AND created_at <= ?";
      args.push(params.to_unix_ms);
    }
    if (params.event_types && params.event_types.length > 0) {
      sql += ` AND event_type IN (${params.event_types.map(() => "?").join(",")})`;
      args.push(...params.event_types);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    args.push(params.limit ?? 100);

    type Row = { id: number; event_type: string; session_id: string | null; user_id: string | null; payload: string; severity: string; created_at: number };
    const rows = this.db.prepare<unknown[], Row>(sql).all(...args);

    return rows.map((r) => ({
      id: r.id,
      event_type: r.event_type as AuditEvent["event_type"],
      session_id: r.session_id ?? undefined,
      user_id: r.user_id ?? undefined,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      severity: r.severity as AuditSeverity,
      created_at_unix_ms: r.created_at,
    }));
  }

  getAlerts(params: { include_acknowledged?: boolean; session_id?: string }): unknown[] {
    let sql = "SELECT * FROM alerts WHERE 1=1";
    const args: unknown[] = [];

    if (!params.include_acknowledged) {
      sql += " AND acknowledged = 0";
    }
    if (params.session_id) {
      sql += " AND session_id = ?";
      args.push(params.session_id);
    }

    sql += " ORDER BY created_at DESC";
    return this.db.prepare<unknown[], unknown>(sql).all(...args);
  }

  acknowledgeAlert(alertId: number): boolean {
    const result = this.db
      .prepare("UPDATE alerts SET acknowledged = 1 WHERE id = ?")
      .run(alertId);
    return result.changes > 0;
  }

  getCostSummary(userId: string, dayUnixMs: number): CostSummaryResult {
    // Compute start/end of UTC day
    const dayStart = dayUnixMs - (dayUnixMs % 86_400_000);
    const dayEnd = dayStart + 86_400_000;

    type CostRow = { model: string; total: number };
    const rows = this.db
      .prepare<[string, number, number], CostRow>(
        "SELECT model, SUM(cost_usd) as total FROM cost_ledger WHERE user_id = ? AND recorded_at >= ? AND recorded_at < ? GROUP BY model"
      )
      .all(userId, dayStart, dayEnd);

    const cost_by_model: Record<string, number> = {};
    let total_cost_usd = 0;
    for (const row of rows) {
      cost_by_model[row.model] = row.total;
      total_cost_usd += row.total;
    }

    const remaining_usd = Math.max(0, this.costCapUsd - total_cost_usd);

    return {
      total_cost_usd,
      cap_usd: this.costCapUsd,
      remaining_usd,
      cap_exceeded: total_cost_usd >= this.costCapUsd,
      cost_by_model,
    };
  }

  recordCost(params: {
    session_id: string;
    user_id: string;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }): void {
    this.db
      .prepare(
        "INSERT INTO cost_ledger (session_id, user_id, provider, model, input_tokens, output_tokens, cost_usd, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        params.session_id,
        params.user_id,
        params.provider,
        params.model,
        params.input_tokens,
        params.output_tokens,
        params.cost_usd,
        nowUtcMs()
      );
  }

  private buildAlertContext(sessionId?: string): AlertContext {
    const now = nowUtcMs();
    const oneMinuteAgo = now - 60_000;
    const fiveMinutesAgo = now - 300_000;
    const todayStart = now - (now % 86_400_000);

    type CountRow = { count: number };

    const toolCallsLastMinute = sessionId
      ? (this.db
          .prepare<[string, number], CountRow>(
            "SELECT COUNT(*) as count FROM audit_events WHERE event_type = 'TOOL_CALL' AND session_id = ? AND created_at >= ?"
          )
          .get(sessionId, oneMinuteAgo)?.count ?? 0)
      : 0;

    const authFailuresLastFiveMin =
      this.db
        .prepare<[number], CountRow>(
          "SELECT COUNT(*) as count FROM audit_events WHERE event_type = 'AUTH_FAILED' AND created_at >= ?"
        )
        .get(fiveMinutesAgo)?.count ?? 0;

    type CostRow = { total: number };
    const dailyCostUsd =
      this.db
        .prepare<[number], CostRow>(
          "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_ledger WHERE recorded_at >= ?"
        )
        .get(todayStart)?.total ?? 0;

    return {
      toolCallsLastMinute,
      authFailuresLastFiveMin,
      dailyCostUsd,
      costCapUsd: this.costCapUsd,
      largestOutputBytesThisSession: 0, // TODO: implement if needed
    };
  }
}
